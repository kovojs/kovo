#!/usr/bin/env bash

set -euo pipefail

# Keep the installer below the smallest caller's 90-minute job wall while preserving its measured
# 16-minute proof tail. The same bound leaves the root job's measured 44-minute tail inside 120m:
# 2 * (1200s attempt + 30s kill grace) + 60s cleanup + 10s cleanup kill grace + 15s backoff
# = 2545s (42m25s).
readonly INSTALL_ATTEMPTS=2
readonly INSTALL_ATTEMPT_TIMEOUT_SECONDS=1200
readonly INSTALL_KILL_AFTER_SECONDS=30
readonly CLEANUP_TIMEOUT_SECONDS=60
readonly CLEANUP_KILL_AFTER_SECONDS=10
readonly RETRY_BACKOFF_SECONDS=15

fail() {
  printf 'playwright-install: %s\n' "$1" >&2
  exit "${2:-1}"
}

validate_browsers() {
  case "$1" in
    chromium | "firefox webkit" | "chromium firefox webkit") return 0 ;;
    *)
      fail \
        "unsupported browsers input '$1'; expected chromium, firefox webkit, or chromium firefox webkit" \
        64
      ;;
  esac
}

remove_playwright_lock() {
  local cache_root
  cache_root="${PLAYWRIGHT_BROWSERS_PATH:-${HOME:?HOME must identify the runner account}/.cache/ms-playwright}"
  case "$cache_root" in
    /*) ;;
    *) fail "Playwright browser cache must be an absolute path before retry cleanup" 65 ;;
  esac
  test "$cache_root" != / || fail "refusing to clean a Playwright lock beneath /" 65
  rm -rf -- "$cache_root/__dirlock"
}

main() {
  local browsers="${1-}"
  local runner_uid sudo_bin timeout_bin vp_bin
  local -a browser_args

  test "$#" -eq 1 || fail "expected exactly one browsers argument" 64
  validate_browsers "$browsers"
  IFS=' ' read -r -a browser_args <<<"$browsers"

  sudo_bin="$(command -v sudo)" || fail "sudo is required to bound root-owned apt descendants" 69
  timeout_bin="$(command -v timeout)" || fail "GNU timeout is required" 69
  vp_bin="$(command -v vp)" || fail "vp is required" 69
  "$timeout_bin" --version 2>/dev/null | grep -q 'GNU coreutils' || fail "GNU timeout is required" 69
  runner_uid="$(id -u)"

  local attempt status=1
  for ((attempt = 1; attempt <= INSTALL_ATTEMPTS; attempt += 1)); do
    printf 'Playwright install attempt %d/%d (deadline %ss, TERM-to-KILL %ss).\n' \
      "$attempt" \
      "$INSTALL_ATTEMPTS" \
      "$INSTALL_ATTEMPT_TIMEOUT_SECONDS" \
      "$INSTALL_KILL_AFTER_SECONDS"

    # GNU timeout is deliberately root-owned, then drops the install back to the runner account.
    # It can therefore terminate Playwright's later root-owned sudo/apt descendants as a group.
    if "$sudo_bin" --non-interactive --preserve-env \
      "$timeout_bin" \
      --verbose \
      --signal=TERM \
      --kill-after="${INSTALL_KILL_AFTER_SECONDS}s" \
      "${INSTALL_ATTEMPT_TIMEOUT_SECONDS}s" \
      "$sudo_bin" \
      --non-interactive \
      --preserve-env \
      --user="#${runner_uid}" \
      /usr/bin/env \
      "HOME=$HOME" \
      "PATH=$PATH" \
      "$vp_bin" exec playwright install --with-deps "${browser_args[@]}"; then
      exit 0
    else
      status=$?
    fi

    if ((attempt == INSTALL_ATTEMPTS)); then
      break
    fi

    printf '::warning::Playwright install attempt %d/%d exited %d; recovering before retry.\n' \
      "$attempt" \
      "$INSTALL_ATTEMPTS" \
      "$status" >&2
    remove_playwright_lock
    if ! "$sudo_bin" --non-interactive \
      "$timeout_bin" \
      --verbose \
      --signal=TERM \
      --kill-after="${CLEANUP_KILL_AFTER_SECONDS}s" \
      "${CLEANUP_TIMEOUT_SECONDS}s" \
      /usr/bin/env DEBIAN_FRONTEND=noninteractive dpkg --configure -a; then
      printf '::warning::Bounded dpkg recovery did not complete successfully; retrying once.\n' >&2
    fi
    sleep "$RETRY_BACKOFF_SECONDS"
  done

  fail "Playwright install failed after ${INSTALL_ATTEMPTS} bounded attempts (last exit ${status})" "$status"
}

main "$@"
