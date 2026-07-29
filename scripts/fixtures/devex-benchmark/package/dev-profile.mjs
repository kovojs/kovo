const digest = (value) => `sha256:${value.repeat(64)}`;

process.stdout.write(
  `kovo-dev-profile/v1 ${JSON.stringify({
    cold: { bodyDigest: digest('a'), durationMs: 12 },
    diagnostic: {
      bodyDigest: digest('c'),
      code: 'KV235',
      durationMs: 3,
      sourceDigest: digest('e'),
    },
    served: {
      bodyDigest: digest('d'),
      durationMs: 4,
      revision: 1,
      sourceDigest: digest('f'),
    },
    warm: { bodyDigest: digest('b'), durationMs: 5 },
  })}\n`,
);
