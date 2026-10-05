#!/usr/bin/env bash
set -euo pipefail
ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
TEMP=$(mktemp -d -t raazictl-test-XXXXXXXX)
cleanup() {
  case "$TEMP" in */raazictl-test-*) rm -rf -- "$TEMP" ;; *) echo 'Unsafe test cleanup path' >&2; exit 1 ;; esac
}
trap cleanup EXIT
mkdir -p "$TEMP/project" "$TEMP/bin"
cp "$ROOT/raazictl" "$ROOT/env.sample.qa" "$ROOT/env.sample.prod" "$TEMP/project/"
export TEST_LOG="$TEMP/calls.log"
export PATH="$TEMP/bin:$PATH"
cat > "$TEMP/bin/podman" <<'MOCK'
#!/usr/bin/env bash
printf 'podman' >> "$TEST_LOG"
printf ' <%s>' "$@" >> "$TEST_LOG"
printf '\n' >> "$TEST_LOG"
if [[ $1 == image && $2 == exists && ${MISSING_IMAGE:-} == "$3" ]]; then exit 1; fi
if [[ $1 == network && $2 == exists && ${MISSING_NETWORK:-0} == 1 ]]; then exit 1; fi
if [[ $1 == compose && ${CONFIG_FAILURE:-0} == 1 && " $* " == *' config '* ]]; then exit 1; fi
MOCK
cat > "$TEMP/bin/git" <<'MOCK'
#!/usr/bin/env bash
printf 'git' >> "$TEST_LOG"
printf ' <%s>' "$@" >> "$TEST_LOG"
printf '\n' >> "$TEST_LOG"
case "$1" in
  status) printf '%s' "${DIRTY_TREE:-}" ;;
  symbolic-ref) [[ ${DETACHED:-0} == 0 ]] || exit 1; echo dev ;;
  rev-parse)
    if [[ $* == *upstream* ]]; then [[ ${NO_UPSTREAM:-0} == 0 ]] || exit 1; echo origin/dev; else echo test-revision; fi ;;
  pull) exit "${PULL_FAILURE:-0}" ;;
esac
MOCK
chmod +x "$TEMP/bin/podman" "$TEMP/bin/git"
ctl() { bash "$TEMP/project/raazictl" "$@"; }
reset_log() { : > "$TEST_LOG"; }
contains() { grep -F -- "$1" "$TEST_LOG" >/dev/null || { echo "Missing call: $1" >&2; cat "$TEST_LOG" >&2; exit 1; }; }
absent() { if grep -F -- "$1" "$TEST_LOG" >/dev/null; then echo "Unexpected call: $1" >&2; cat "$TEST_LOG" >&2; exit 1; fi; }
must_fail() { if "$@" > "$TEMP/result" 2>&1; then echo "Unexpected success: $*" >&2; exit 1; fi; }

# Initialization preserves existing configuration and never invokes Podman.
reset_log
ctl init > /dev/null
printf '\n# preserved\n' >> "$TEMP/project/.env.qa"
ctl init > /dev/null
grep -F '# preserved' "$TEMP/project/.env.qa" >/dev/null
[[ ! -s $TEST_LOG ]]

# Normal startup uses prepared images, QA env selection and no build/download.
reset_log
ctl start > /dev/null
contains '<image> <exists> <localhost/raazi:local>'
contains '<image> <exists> <docker.io/pgvector/pgvector:0.8.6-pg17>'
contains '<--env-file> <.env.qa>'
contains '<up> <-d> <--no-build>'
absent '<pull>'; absent '<build>'; absent '<down>'

# Missing images, networks or invalid config must not stop a running deployment.
for failure in image network config; do
  reset_log
  case "$failure" in
    image) export MISSING_IMAGE=localhost/raazi:local ;;
    network) export MISSING_NETWORK=1 ;;
    config) export CONFIG_FAILURE=1 ;;
  esac
  must_fail ctl restart
  absent '<down>'; absent '<up>'; absent '<build>'; absent '<pull>'
  unset MISSING_IMAGE MISSING_NETWORK CONFIG_FAILURE
done

# Restart validates before teardown. Stop never removes volumes.
reset_log; ctl restart > /dev/null
contains '<down>'; contains '<up> <-d> <--no-build>'; absent '<pull>'; absent '<build>'
reset_log; ctl stop > /dev/null
contains '<down>'; absent '<-v>'; absent '<--volumes>'

# Preparation is the sole image-download/build path and starts no services.
reset_log; ctl prepare > /dev/null
contains '<pull> <docker.io/pgvector/pgvector:0.8.6-pg17>'
contains '<build> <--label> <io.raazi.revision=test-revision>'
absent '<up>'; absent '<down>'
reset_log; ctl prepare vectors > /dev/null
contains '<pull>'; absent '<build>'
reset_log; ctl prepare app > /dev/null
contains '<build>'; absent '<pull>'

# Update only fast-forwards Git. It refuses dirty/detached/untracked branches.
reset_log; ctl update > /dev/null
contains '<pull> <--ff-only>'; absent 'podman'
for failure in dirty detached upstream pull; do
  reset_log
  case "$failure" in
    dirty) export DIRTY_TREE=' M README.md' ;;
    detached) export DETACHED=1 ;;
    upstream) export NO_UPSTREAM=1 ;;
    pull) export PULL_FAILURE=1 ;;
  esac
  must_fail ctl update
  absent 'podman'
  if [[ $failure != pull ]]; then absent '<pull>'; fi
  unset DIRTY_TREE DETACHED NO_UPSTREAM PULL_FAILURE
done

# Production reads its own file, accepts quoted tags, and scopes status to its project.
ctl --env prod init > /dev/null
printf '\nRAAZI_IMAGE_TAG="release-1"\n' >> "$TEMP/project/.env.prod"
reset_log; ctl --env prod start > /dev/null
contains '<--env-file> <.env.prod>'
contains '<image> <exists> <localhost/raazi:release-1>'
reset_log; ctl status > /dev/null
contains '<label=com.docker.compose.project=raazi-qa>'; absent '<pull>'; absent '<build>'
ln -s "$TEMP/project/raazictl" "$TEMP/bin/raazictl"
reset_log
if [[ -L "$TEMP/bin/raazictl" ]]; then
  (cd "$TEMP"; bash "$TEMP/bin/raazictl" status > /dev/null)
  contains '<label=com.docker.compose.project=raazi-qa>'
else
  echo 'Symlink check skipped: this platform copied the target instead of creating a symlink.'
fi
printf '\nRAAZI_IMAGE_TAG=$(touch SHOULD_NOT_EXIST)\n' >> "$TEMP/project/.env.prod"
reset_log; must_fail ctl --env prod start
[[ ! -e "$TEMP/project/SHOULD_NOT_EXIST" ]]
absent 'podman'
must_fail ctl --env invalid start
must_fail ctl restart extra
must_fail ctl logs unrelated

# Compose startup files independently forbid automatic image pulls and builds.
[[ $(grep -c 'pull_policy: never' "$ROOT/compose.podman.yaml") == 2 ]]
# podman-compose rejects explicit default references without a network declaration.
grep -Fx '  default:' "$ROOT/compose.podman.yaml" > /dev/null
if grep -Eq '^[[:space:]]+build:' "$ROOT/compose.production.yaml" "$ROOT/compose.podman.yaml"; then
  echo 'Runtime Compose files contain a build recipe' >&2; exit 1
fi
echo 'raazictl contract checks passed (mocked Git and Podman; no live services).'
