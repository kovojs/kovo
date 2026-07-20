--------------------------- MODULE ReplayReservation ---------------------------
EXTENDS FiniteSets, Integers, TLC

\* SPEC §10.3. This is a bounded state model of the replay reservation protocol,
\* not a model of Postgres itself. Each registered SQL transition below is one
\* atomic action under the separately disclosed Postgres-CTE atomicity axiom.

CONSTANTS
    Replica1,
    Replica2,
    Slot1,
    Slot2,
    Identity1,
    Identity2,
    NoReplica,
    NoSlot,
    NoIdentity,
    AllowPendingEviction,
    NaiveWatermark

Replicas == {Replica1, Replica2}
Slots == {Slot1, Slot2}
Identities == {Identity1, Identity2}

Statuses == {"absent", "pending", "committed"}
Phases == {"idle", "reserved", "effected"}
ClockValues == 0..2

Expiry(identity) == IF identity = Identity1 THEN 1 ELSE 2
Max(left, right) == IF left >= right THEN left ELSE right

VARIABLES
    status,
    owner,
    admissionSlot,
    claim,
    phase,
    live,
    executions,
    reads,
    refusals,
    pendingEvicted,
    reclaimed,
    reclaimedThrough,
    highestReclaimedThrough,
    clock,
    backwardClockSteps,
    crashPoints

vars == <<
    status,
    owner,
    admissionSlot,
    claim,
    phase,
    live,
    executions,
    reads,
    refusals,
    pendingEvicted,
    reclaimed,
    reclaimedThrough,
    highestReclaimedThrough,
    clock,
    backwardClockSteps,
    crashPoints
>>

PendingIdentities == {identity \in Identities : status[identity] = "pending"}
OccupiedSlots == {admissionSlot[identity] : identity \in PendingIdentities}
Free(slot) == slot \in Slots \ OccupiedSlots

Init ==
    /\ status = [identity \in Identities |-> "absent"]
    /\ owner = [identity \in Identities |-> NoReplica]
    /\ admissionSlot = [identity \in Identities |-> NoSlot]
    /\ claim = [replica \in Replicas |-> NoIdentity]
    /\ phase = [replica \in Replicas |-> "idle"]
    /\ live = [replica \in Replicas |-> TRUE]
    /\ executions = [identity \in Identities |-> 0]
    /\ reads = FALSE
    /\ refusals = FALSE
    /\ pendingEvicted = [identity \in Identities |-> FALSE]
    /\ reclaimed = [identity \in Identities |-> FALSE]
    /\ reclaimedThrough = 0
    /\ highestReclaimedThrough = 0
    /\ clock = 0
    /\ backwardClockSteps = 0
    /\ crashPoints = 0

\* @kovo-model-action replay.reserve
\* The SQL action locks the watermark, selects one unoccupied numbered slot,
\* rejects stale/reclaimed horizons, and inserts pending truth ON CONFLICT DO NOTHING.
Reserve(replica, identity, slot) ==
    /\ live[replica]
    /\ claim[replica] = NoIdentity
    /\ status[identity] = "absent"
    /\ Expiry(identity) > clock
    /\ Expiry(identity) > reclaimedThrough
    /\ Free(slot)
    /\ status' = [status EXCEPT ![identity] = "pending"]
    /\ owner' = [owner EXCEPT ![identity] = replica]
    /\ admissionSlot' = [admissionSlot EXCEPT ![identity] = slot]
    /\ claim' = [claim EXCEPT ![replica] = identity]
    /\ phase' = [phase EXCEPT ![replica] = "reserved"]
    /\ UNCHANGED <<
        live,
        executions,
        reads,
        refusals,
        pendingEvicted,
        reclaimed,
        reclaimedThrough,
        highestReclaimedThrough,
        clock,
        backwardClockSteps,
        crashPoints
        >>

\* Application work is deliberately separate from the atomic SQL alphabet. It
\* represents the point at which the money-moving transaction may have committed.
Execute(replica) ==
    \E identity \in Identities :
        /\ live[replica]
        /\ claim[replica] = identity
        /\ phase[replica] = "reserved"
        /\ status[identity] = "pending"
        /\ owner[identity] = replica
        /\ executions[identity] < 2
        /\ phase' = [phase EXCEPT ![replica] = "effected"]
        /\ executions' = [executions EXCEPT ![identity] = @ + 1]
        /\ UNCHANGED <<
            status,
            owner,
            admissionSlot,
            claim,
            live,
            reads,
            refusals,
            pendingEvicted,
            reclaimed,
            reclaimedThrough,
            highestReclaimedThrough,
            clock,
            backwardClockSteps,
            crashPoints
            >>

\* @kovo-model-action replay.commit
\* Settlement is generation/owner fenced, checks current time and the durable
\* watermark, and clears the admission slot only when pending becomes committed.
Commit(replica) ==
    \E identity \in Identities :
        /\ live[replica]
        /\ claim[replica] = identity
        /\ phase[replica] = "effected"
        /\ status[identity] = "pending"
        /\ owner[identity] = replica
        /\ Expiry(identity) > clock
        /\ Expiry(identity) > reclaimedThrough
        /\ status' = [status EXCEPT ![identity] = "committed"]
        /\ owner' = [owner EXCEPT ![identity] = NoReplica]
        /\ admissionSlot' = [admissionSlot EXCEPT ![identity] = NoSlot]
        /\ claim' = [claim EXCEPT ![replica] = NoIdentity]
        /\ phase' = [phase EXCEPT ![replica] = "idle"]
        /\ UNCHANGED <<
            live,
            executions,
            reads,
            refusals,
            pendingEvicted,
            reclaimed,
            reclaimedThrough,
            highestReclaimedThrough,
            clock,
            backwardClockSteps,
            crashPoints
            >>

\* @kovo-model-action replay.abort
\* Abort is safe only before the application effect; it deletes the exact pending
\* owner and releases that slot.
Abort(replica) ==
    \E identity \in Identities :
        /\ live[replica]
        /\ claim[replica] = identity
        /\ phase[replica] = "reserved"
        /\ status[identity] = "pending"
        /\ owner[identity] = replica
        /\ status' = [status EXCEPT ![identity] = "absent"]
        /\ owner' = [owner EXCEPT ![identity] = NoReplica]
        /\ admissionSlot' = [admissionSlot EXCEPT ![identity] = NoSlot]
        /\ claim' = [claim EXCEPT ![replica] = NoIdentity]
        /\ phase' = [phase EXCEPT ![replica] = "idle"]
        /\ UNCHANGED <<
            live,
            executions,
            reads,
            refusals,
            pendingEvicted,
            reclaimed,
            reclaimedThrough,
            highestReclaimedThrough,
            clock,
            backwardClockSteps,
            crashPoints
            >>

\* @kovo-model-action replay.releasePending
\* Operator reconciliation is represented only when the crashed owner had not
\* crossed the application-effect point. Ambiguous effected claims stay pending.
ReleasePending(identity) ==
    \E replica \in Replicas :
        /\ ~live[replica]
        /\ claim[replica] = identity
        /\ phase[replica] = "reserved"
        /\ status[identity] = "pending"
        /\ owner[identity] = replica
        /\ status' = [status EXCEPT ![identity] = "absent"]
        /\ owner' = [owner EXCEPT ![identity] = NoReplica]
        /\ admissionSlot' = [admissionSlot EXCEPT ![identity] = NoSlot]
        /\ claim' = [claim EXCEPT ![replica] = NoIdentity]
        /\ phase' = [phase EXCEPT ![replica] = "idle"]
        /\ UNCHANGED <<
            live,
            executions,
            reads,
            refusals,
            pendingEvicted,
            reclaimed,
            reclaimedThrough,
            highestReclaimedThrough,
            clock,
            backwardClockSteps,
            crashPoints
            >>

\* @kovo-model-action replay.read
Read(replica, identity) ==
    /\ live[replica]
    /\ status[identity] \in {"pending", "committed"}
    /\ ~reads
    /\ reads' = TRUE
    /\ UNCHANGED <<
        status,
        owner,
        admissionSlot,
        claim,
        phase,
        live,
        executions,
        refusals,
        pendingEvicted,
        reclaimed,
        reclaimedThrough,
        highestReclaimedThrough,
        clock,
        backwardClockSteps,
        crashPoints
        >>

\* @kovo-model-action replay.settle
\* Direct settlement atomically creates committed truth only for a fresh identity.
Settle(replica, identity) ==
    /\ live[replica]
    /\ claim[replica] = NoIdentity
    /\ status[identity] = "absent"
    /\ Expiry(identity) > clock
    /\ Expiry(identity) > reclaimedThrough
    /\ status' = [status EXCEPT ![identity] = "committed"]
    /\ executions' = [executions EXCEPT ![identity] = Max(@, 1)]
    /\ UNCHANGED <<
        owner,
        admissionSlot,
        claim,
        phase,
        live,
        reads,
        refusals,
        pendingEvicted,
        reclaimed,
        reclaimedThrough,
        highestReclaimedThrough,
        clock,
        backwardClockSteps,
        crashPoints
        >>

\* @kovo-model-action replay.reclaimCommitted
\* Production advances with GREATEST(old, max deleted). The broken configuration
\* intentionally assigns only the selected deleted horizon, and can assign a
\* rolled-back cleanup horizon when no row is deleted, to reproduce regression.
NoEarlierExpired(identity) ==
    \A other \in Identities :
        \/ status[other] # "committed"
        \/ Expiry(other) > clock
        \/ Expiry(identity) <= Expiry(other)

ReclaimOne(identity) ==
    /\ status[identity] = "committed"
    /\ Expiry(identity) <= clock
    /\ NoEarlierExpired(identity)
    /\ LET nextWatermark ==
               IF NaiveWatermark
               THEN Expiry(identity)
               ELSE Max(reclaimedThrough, Expiry(identity))
       IN /\ status' = [status EXCEPT ![identity] = "absent"]
          /\ reclaimed' = [reclaimed EXCEPT ![identity] = TRUE]
          /\ reclaimedThrough' = nextWatermark
          /\ highestReclaimedThrough' = Max(highestReclaimedThrough, nextWatermark)
    /\ UNCHANGED <<
        owner,
        admissionSlot,
        claim,
        phase,
        live,
        executions,
        reads,
        refusals,
        pendingEvicted,
        clock,
        backwardClockSteps,
        crashPoints
        >>

\* Explore the later horizon first so the naive broken model has one stable,
\* deterministic regression trace after the single backward-clock step.
ReclaimCommitted ==
    \/ ReclaimOne(Identity2)
    \/ ReclaimOne(Identity1)

\* The production CTE preserves the old watermark when a cleanup batch deletes
\* nothing. The naive mutant records the rolled-back database clock instead.
CleanupAfterRollback ==
    /\ backwardClockSteps = 1
    /\ ~\E identity \in Identities :
          /\ status[identity] = "committed"
          /\ Expiry(identity) <= clock
    /\ LET nextWatermark == IF NaiveWatermark THEN clock ELSE reclaimedThrough
       IN /\ reclaimedThrough' = nextWatermark
          /\ highestReclaimedThrough' = Max(highestReclaimedThrough, nextWatermark)
    /\ UNCHANGED <<
        status,
        owner,
        admissionSlot,
        claim,
        phase,
        live,
        executions,
        reads,
        refusals,
        pendingEvicted,
        reclaimed,
        clock,
        backwardClockSteps,
        crashPoints
        >>

Refuse(replica, identity) ==
    /\ live[replica]
    /\ claim[replica] = NoIdentity
    /\ \/ status[identity] = "pending"
       \/ /\ status[identity] = "absent"
          /\ Expiry(identity) > clock
          /\ Expiry(identity) > reclaimedThrough
          /\ OccupiedSlots = Slots
    /\ ~refusals
    /\ refusals' = TRUE
    /\ UNCHANGED <<
        status,
        owner,
        admissionSlot,
        claim,
        phase,
        live,
        executions,
        reads,
        pendingEvicted,
        reclaimed,
        reclaimedThrough,
        highestReclaimedThrough,
        clock,
        backwardClockSteps,
        crashPoints
        >>

\* Historical A6/M4 mutant: a pending row disappears while its owner may already
\* have applied the effect. The local stale owner is intentionally not rewritten.
EvictPending(identity) ==
    /\ AllowPendingEviction
    /\ status[identity] = "pending"
    /\ status' = [status EXCEPT ![identity] = "absent"]
    /\ owner' = [owner EXCEPT ![identity] = NoReplica]
    /\ admissionSlot' = [admissionSlot EXCEPT ![identity] = NoSlot]
    /\ pendingEvicted' = [pendingEvicted EXCEPT ![identity] = TRUE]
    /\ UNCHANGED <<
        claim,
        phase,
        live,
        executions,
        reads,
        refusals,
        reclaimed,
        reclaimedThrough,
        highestReclaimedThrough,
        clock,
        backwardClockSteps,
        crashPoints
        >>

Tick ==
    /\ clock < 2
    /\ clock' = clock + 1
    /\ UNCHANGED <<
        status,
        owner,
        admissionSlot,
        claim,
        phase,
        live,
        executions,
        reads,
        refusals,
        pendingEvicted,
        reclaimed,
        reclaimedThrough,
        highestReclaimedThrough,
        backwardClockSteps,
        crashPoints
        >>

BackwardClockStep ==
    /\ backwardClockSteps = 0
    /\ clock = 2
    /\ clock' = 0
    /\ backwardClockSteps' = 1
    /\ UNCHANGED <<
        status,
        owner,
        admissionSlot,
        claim,
        phase,
        live,
        executions,
        reads,
        refusals,
        pendingEvicted,
        reclaimed,
        reclaimedThrough,
        highestReclaimedThrough,
        crashPoints
        >>

Crash(replica) ==
    /\ crashPoints = 0
    /\ live[replica]
    /\ claim[replica] # NoIdentity
    /\ live' = [live EXCEPT ![replica] = FALSE]
    /\ crashPoints' = 1
    /\ UNCHANGED <<
        status,
        owner,
        admissionSlot,
        claim,
        phase,
        executions,
        reads,
        refusals,
        pendingEvicted,
        reclaimed,
        reclaimedThrough,
        highestReclaimedThrough,
        clock,
        backwardClockSteps
        >>

Next ==
    \/ \E replica \in Replicas, identity \in Identities, slot \in Slots :
          Reserve(replica, identity, slot)
    \/ \E replica \in Replicas : Execute(replica)
    \/ \E replica \in Replicas : Commit(replica)
    \/ \E replica \in Replicas : Abort(replica)
    \/ \E identity \in Identities : ReleasePending(identity)
    \/ \E replica \in Replicas, identity \in Identities : Read(replica, identity)
    \/ \E replica \in Replicas, identity \in Identities : Settle(replica, identity)
    \/ ReclaimCommitted
    \/ CleanupAfterRollback
    \/ \E replica \in Replicas, identity \in Identities : Refuse(replica, identity)
    \/ \E identity \in Identities : EvictPending(identity)
    \/ Tick
    \/ BackwardClockStep
    \/ \E replica \in Replicas : Crash(replica)

Spec == Init /\ [][Next]_vars

TypeOK ==
    /\ status \in [Identities -> Statuses]
    /\ owner \in [Identities -> (Replicas \cup {NoReplica})]
    /\ admissionSlot \in [Identities -> (Slots \cup {NoSlot})]
    /\ claim \in [Replicas -> (Identities \cup {NoIdentity})]
    /\ phase \in [Replicas -> Phases]
    /\ live \in [Replicas -> BOOLEAN]
    /\ executions \in [Identities -> 0..2]
    /\ reads \in BOOLEAN
    /\ refusals \in BOOLEAN
    /\ pendingEvicted \in [Identities -> BOOLEAN]
    /\ reclaimed \in [Identities -> BOOLEAN]
    /\ reclaimedThrough \in ClockValues
    /\ highestReclaimedThrough \in ClockValues
    /\ clock \in ClockValues
    /\ backwardClockSteps \in 0..1
    /\ crashPoints \in 0..1

NoDoubleExecute == \A identity \in Identities : executions[identity] <= 1

RefuseNeverEvict == \A identity \in Identities : ~pendingEvicted[identity]

MonotoneReclaimedThrough == reclaimedThrough = highestReclaimedThrough

NoResurrection ==
    \A identity \in Identities : reclaimed[identity] => status[identity] = "absent"

BoundedAdmission ==
    /\ Cardinality(PendingIdentities) <= Cardinality(Slots)
    /\ Cardinality(OccupiedSlots) = Cardinality(PendingIdentities)
    /\ \A identity \in Identities :
          (status[identity] = "pending") <=> (admissionSlot[identity] \in Slots)

=============================================================================
