#!/usr/bin/env bash
set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT_NAME="$(basename "${BASH_SOURCE[0]}")"
SELF="$SCRIPT_DIR/$SCRIPT_NAME"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DATA_TRANSFORM_DIR="$REPO_DIR/data-transform"
SAMPLE_DATA_DIR="$DATA_TRANSFORM_DIR/sample"
RAW_DATA_DIR="$DATA_TRANSFORM_DIR/raw"
PREPARED_CORPUS_DIR="$SCRIPT_DIR/data/corpus"

cd "$SCRIPT_DIR"

RUNTIME_DIR="$SCRIPT_DIR/.control"
mkdir -p "$RUNTIME_DIR"

CURRENT_LOCK=""

usage() {
  cat <<USAGE
Usage:
  ./$SCRIPT_NAME deps [--option install|reinstall|abort|exit]
  ./$SCRIPT_NAME test [--option start|abort|exit]
  ./$SCRIPT_NAME build [--option start|abort|exit]
  ./$SCRIPT_NAME dev [--option start|stop|exit]
  ./$SCRIPT_NAME data [--option samples|prepare|all|exit]
USAGE
}

prepared_corpus_ready() {
  [[ -f "$PREPARED_CORPUS_DIR/manifest.json" &&
     -f "$PREPARED_CORPUS_DIR/corpus.sqlite" ]]
}

run_data_samples() {
  python "$DATA_TRANSFORM_DIR/scripts/extract-sample-data/FLEURS.py" \
    --input-root "$RAW_DATA_DIR/FLEURS" \
    --output-root "$SAMPLE_DATA_DIR/FLEURS" \
    --replace || return $?

  python "$DATA_TRANSFORM_DIR/scripts/extract-sample-data/Shrutilipi.py" \
    --input-root "$RAW_DATA_DIR/Shrutilipi" \
    --output-root "$SAMPLE_DATA_DIR/Shrutilipi"
    || return $?

  python "$DATA_TRANSFORM_DIR/scripts/extract-sample-data/IndicVoices.py" \
    --input-root "$RAW_DATA_DIR/IndicVoices" \
    --output-root "$SAMPLE_DATA_DIR/IndicVoices"
    || return $?
}

run_data_prepare() {
  python "$DATA_TRANSFORM_DIR/scripts/prepare-corpus/prepare.py" \
    --input "$SAMPLE_DATA_DIR" \
    --output "$PREPARED_CORPUS_DIR" \
    --replace
}

run_data_domain() {
  local option="${1:-}"

  if [[ -z "$option" ]]; then
    printf 'DATA OPTIONS\n'
    printf '1) samples\n'
    printf '2) prepare\n'
    printf '3) all\n'
    printf '4) exit\n'
    printf '\nSelect option: '
    read -r selection
    case "$selection" in
      1) option="samples" ;;
      2) option="prepare" ;;
      3) option="all" ;;
      4) option="exit" ;;
      *) printf 'ERROR: invalid selection.\n' >&2; return 2 ;;
    esac
  fi

  case "$option" in
    samples)
      run_data_samples
      ;;
    prepare)
      run_data_prepare
      ;;
    all)
      run_data_samples || return $?
      run_data_prepare || return $?
      ;;
    exit)
      return 0
      ;;
    *)
      printf 'ERROR: invalid data option "%s".\n' "$option" >&2
      return 2
      ;;
  esac
}

domain_dir() {
  printf '%s/%s' "$RUNTIME_DIR" "$1"
}

pid_file() {
  printf '%s/pid' "$(domain_dir "$1")"
}

pgid_file() {
  printf '%s/pgid' "$(domain_dir "$1")"
}

state_file() {
  printf '%s/state' "$(domain_dir "$1")"
}

result_file() {
  printf '%s/result' "$(domain_dir "$1")"
}

log_file() {
  printf '%s/%s.log' "$RUNTIME_DIR" "$1"
}

lock_dir() {
  printf '%s/%s.lock' "$RUNTIME_DIR" "$1"
}

ensure_domain_dir() {
  mkdir -p "$(domain_dir "$1")"
}

read_file_or() {
  local file="$1"
  local fallback="$2"

  if [[ -f "$file" ]]; then
    cat "$file"
  else
    printf '%s' "$fallback"
  fi
}

process_alive() {
  local pid="$1"
  kill -0 "$pid" 2>/dev/null
}

process_group_alive() {
  local pgid="$1"
  kill -0 -- "-$pgid" 2>/dev/null
}

managed_process_is_ours() {
  local pid="$1"
  local domain="$2"
  local command

  command="$(ps -p "$pid" -o command= 2>/dev/null || true)"

  [[ "$command" == *"$SCRIPT_NAME __runner $domain"* ]]
}

dev_process_is_ours() {
  local pid="$1"
  local command

  command="$(ps -p "$pid" -o command= 2>/dev/null || true)"

  [[ "$command" == *"control-dev"* ]]
}

dependencies_installed() {
  [[ -d "$SCRIPT_DIR/node_modules" ]] || return 1
  npm ls --depth=0 --silent >/dev/null 2>&1
}

clean_stale_dev_state() {
  rm -f "$(pid_file dev)"
  rm -f "$(pgid_file dev)"
  printf 'stopped' > "$(state_file dev)"
}

status_of() {
  local domain="$1"
  local pf pgf sf pid pgid stored dependency_status

  ensure_domain_dir "$domain"

  pf="$(pid_file "$domain")"
  sf="$(state_file "$domain")"

  if [[ "$domain" == "dev" ]]; then
    pgf="$(pgid_file dev)"

    if [[ -f "$pf" && -f "$pgf" ]]; then
      pid="$(cat "$pf" 2>/dev/null || true)"
      pgid="$(cat "$pgf" 2>/dev/null || true)"

      if [[ "$pid" =~ ^[0-9]+$ && "$pgid" =~ ^[0-9]+$ ]] &&
         process_alive "$pid" &&
         process_group_alive "$pgid" &&
         dev_process_is_ours "$pid"
      then
        stored="$(read_file_or "$sf" running)"
        printf '%s' "$stored"
        return
      fi
    fi

    clean_stale_dev_state
    printf 'stopped'
    return
  fi

  if [[ -f "$pf" ]]; then
    pid="$(cat "$pf" 2>/dev/null || true)"

    if [[ "$pid" =~ ^[0-9]+$ ]] &&
       process_alive "$pid" &&
       managed_process_is_ours "$pid" "$domain"
    then
      stored="$(read_file_or "$sf" running)"
      printf '%s' "$stored"
      return
    fi

    rm -f "$pf"
  fi

  if [[ "$domain" == "deps" ]]; then
    if dependencies_installed; then
      dependency_status="installed"
    else
      dependency_status="not-installed"
    fi

    printf '%s' "$dependency_status" > "$sf"
    printf '%s' "$dependency_status"
    return
  fi

  printf 'stopped' > "$sf"
  printf 'stopped'
}

print_status() {
  local domain="$1"
  local status result pid pgid

  status="$(status_of "$domain")"

  printf '%s STATUS\n' \
    "$(printf '%s' "$domain" | tr '[:lower:]' '[:upper:]')"

  printf 'Status: %s\n' "$status"

  if [[ "$status" == "starting" ||
        "$status" == "running" ||
        "$status" == "stopping" ]]
  then
    if [[ -f "$(pid_file "$domain")" ]]; then
      pid="$(cat "$(pid_file "$domain")")"
      printf 'PID: %s\n' "$pid"
    fi

    if [[ "$domain" == "dev" && -f "$(pgid_file dev)" ]]; then
      pgid="$(cat "$(pgid_file dev)")"
      printf 'Process group: %s\n' "$pgid"
    fi
  fi

  if [[ "$domain" != "dev" && -f "$(result_file "$domain")" ]]; then
    result="$(cat "$(result_file "$domain")")"
    printf 'Last result: %s\n' "$result"
  fi
}

valid_options() {
  local domain="$1"
  local status="$2"

  case "$domain:$status" in
    deps:not-installed)
      printf 'install exit'
      ;;
    deps:installed)
      printf 'reinstall exit'
      ;;
    deps:running|deps:starting)
      printf 'abort exit'
      ;;
    deps:stopping)
      printf 'exit'
      ;;

    test:stopped|build:stopped)
      printf 'start exit'
      ;;
    test:running|build:running|test:starting|build:starting)
      printf 'abort exit'
      ;;
    test:stopping|build:stopping)
      printf 'exit'
      ;;

    dev:stopped)
      printf 'start exit'
      ;;
    dev:starting|dev:running)
      printf 'stop exit'
      ;;
    dev:stopping)
      printf 'exit'
      ;;

    *)
      printf 'exit'
      ;;
  esac
}

contains_option() {
  local wanted="$1"
  shift

  local option

  for option in "$@"; do
    [[ "$option" == "$wanted" ]] && return 0
  done

  return 1
}

acquire_lock() {
  local domain="$1"
  local lock

  lock="$(lock_dir "$domain")"

  if ! mkdir "$lock" 2>/dev/null; then
    printf 'ERROR: another control action for "%s" is already in progress.\n' \
      "$domain" >&2
    return 1
  fi

  CURRENT_LOCK="$lock"

  trap '[[ -n "${CURRENT_LOCK:-}" ]] && rmdir "$CURRENT_LOCK" 2>/dev/null || true' EXIT
}

release_lock() {
  if [[ -n "${CURRENT_LOCK:-}" ]]; then
    rmdir "$CURRENT_LOCK" 2>/dev/null || true
    CURRENT_LOCK=""
  fi
}

start_managed_domain() {
  local domain="$1"
  local action="${2:-start}"
  local sf pf lf runner_pid status

  acquire_lock "$domain" || return 1

  status="$(status_of "$domain")"

  if [[ "$domain" == "deps" ]]; then
    case "$action:$status" in
      install:not-installed|reinstall:installed)
        ;;
      *)
        printf 'ERROR: option "%s" is no longer valid while %s is %s.\n' \
          "$action" "$domain" "$status" >&2
        release_lock
        return 1
        ;;
    esac
  elif [[ "$status" != "stopped" ]]; then
    printf 'ERROR: "%s" is no longer stopped.\n' "$domain" >&2
    release_lock
    return 1
  fi

  sf="$(state_file "$domain")"
  pf="$(pid_file "$domain")"
  lf="$(log_file "$domain")"

  : > "$lf"
  printf 'running' > "$sf"

  nohup bash "$SELF" __runner "$domain" "$action" >> "$lf" 2>&1 &
  runner_pid=$!

  printf '%s' "$runner_pid" > "$pf"

  release_lock

  printf 'Started %s %s (PID %s).\n' "$domain" "$action" "$runner_pid"
}

stop_managed_domain() {
  local domain="$1"
  local action="$2"
  local status pid

  acquire_lock "$domain" || return 1

  status="$(status_of "$domain")"

  if [[ "$status" != "starting" &&
        "$status" != "running" &&
        "$status" != "stopping" ]]
  then
    printf 'ERROR: "%s" is not running.\n' "$domain" >&2
    release_lock
    return 1
  fi

  if [[ ! -f "$(pid_file "$domain")" ]]; then
    printf 'ERROR: "%s" has no managed process.\n' "$domain" >&2
    release_lock
    return 1
  fi

  pid="$(cat "$(pid_file "$domain")")"

  printf 'stopping' > "$(state_file "$domain")"
  kill -TERM "$pid" 2>/dev/null || true

  release_lock

  printf '%s requested for %s.\n' "$action" "$domain"
}

terminate_process_group() {
  local pgid="$1"
  local signal="${2:-TERM}"
  local attempt

  if ! process_group_alive "$pgid"; then
    return 0
  fi

  kill -s "$signal" -- "-$pgid" 2>/dev/null || true

  for attempt in {1..20}; do
    if ! process_group_alive "$pgid"; then
      return 0
    fi

    sleep 0.25
  done

  if process_group_alive "$pgid"; then
    kill -KILL -- "-$pgid" 2>/dev/null || true
  fi
}

cleanup_dev_if_owned() {
  local expected_pid="$1"
  local expected_pgid="$2"
  local stored_pid=""
  local stored_pgid=""

  if [[ -f "$(pid_file dev)" ]]; then
    stored_pid="$(cat "$(pid_file dev)" 2>/dev/null || true)"
  fi

  if [[ -f "$(pgid_file dev)" ]]; then
    stored_pgid="$(cat "$(pgid_file dev)" 2>/dev/null || true)"
  fi

  if [[ "$stored_pid" == "$expected_pid" &&
        "$stored_pgid" == "$expected_pgid" ]]
  then
    rm -f "$(pid_file dev)"
    rm -f "$(pgid_file dev)"
    printf 'stopped' > "$(state_file dev)"
  fi
}

run_dev_foreground() {
  local status dev_pid dev_pgid lf rc=0

  if ! prepared_corpus_ready; then
    printf 'ERROR: CORPUS_NOT_PREPARED\n' >&2
    printf 'Run "./%s data --option prepare" first.\n' \
      "$SCRIPT_NAME" >&2
    return 1
  fi

  if ! command -v setsid >/dev/null 2>&1; then
    printf 'ERROR: "setsid" is required to manage the development process group.\n' >&2
    return 1
  fi

  acquire_lock dev || return 1

  status="$(status_of dev)"

  if [[ "$status" != "stopped" ]]; then
    printf 'ERROR: development server is already running.\n' >&2
    release_lock
    return 1
  fi

  ensure_domain_dir dev

  lf="$(log_file dev)"
  : > "$lf"

  printf 'starting' > "$(state_file dev)"

  setsid bash -c '
    set -o pipefail
    npm run dev 2>&1 | tee "$1"
  ' control-dev "$lf" &

  dev_pid=$!
  dev_pgid="$dev_pid"

  printf '%s' "$dev_pid" > "$(pid_file dev)"
  printf '%s' "$dev_pgid" > "$(pgid_file dev)"
  printf 'running' > "$(state_file dev)"

  release_lock

  dev_interrupt() {
    printf '\nStopping development server...\n'
    printf 'stopping' > "$(state_file dev)"
    terminate_process_group "$dev_pgid" INT
  }

  dev_terminate() {
    printf '\nStopping development server...\n'
    printf 'stopping' > "$(state_file dev)"
    terminate_process_group "$dev_pgid" TERM
  }

  dev_cleanup() {
    cleanup_dev_if_owned "$dev_pid" "$dev_pgid"
  }

  trap dev_interrupt INT
  trap dev_terminate TERM
  trap dev_cleanup EXIT

  printf 'Starting development server in the foreground. Press Ctrl+C to stop.\n\n'

  wait "$dev_pid" || rc=$?

  if process_group_alive "$dev_pgid"; then
    terminate_process_group "$dev_pgid" TERM
  fi

  cleanup_dev_if_owned "$dev_pid" "$dev_pgid"

  trap - INT
  trap - TERM
  trap - EXIT

  return "$rc"
}

stop_dev_domain() {
  local status pid pgid

  acquire_lock dev || return 1

  status="$(status_of dev)"

  if [[ "$status" != "starting" &&
        "$status" != "running" &&
        "$status" != "stopping" ]]
  then
    printf 'ERROR: development server is not running.\n' >&2
    release_lock
    return 1
  fi

  if [[ ! -f "$(pid_file dev)" || ! -f "$(pgid_file dev)" ]]; then
    printf 'ERROR: development server has no managed process information.\n' >&2
    clean_stale_dev_state
    release_lock
    return 1
  fi

  pid="$(cat "$(pid_file dev)")"
  pgid="$(cat "$(pgid_file dev)")"

  if [[ ! "$pid" =~ ^[0-9]+$ || ! "$pgid" =~ ^[0-9]+$ ]] ||
     ! process_alive "$pid" ||
     ! process_group_alive "$pgid" ||
     ! dev_process_is_ours "$pid"
  then
    printf 'ERROR: development process information is stale.\n' >&2
    clean_stale_dev_state
    release_lock
    return 1
  fi

  printf 'stopping' > "$(state_file dev)"

  release_lock

  printf 'Stopping development server...\n'

  terminate_process_group "$pgid" TERM
  cleanup_dev_if_owned "$pid" "$pgid"

  printf 'Development server stopped.\n'
}

deps_exec() {
  local action="$1"

  if [[ "$action" == "reinstall" &&
        ! -f "$SCRIPT_DIR/package-lock.json" ]]
  then
    rm -rf "$SCRIPT_DIR/node_modules"
  fi

  if [[ -f "$SCRIPT_DIR/package-lock.json" ]]; then
    exec npm ci
  fi

  exec npm install
}

runner() {
  local domain="$1"
  local action="${2:-start}"
  local child_pid=""
  local rc=0
  local aborted=0

  ensure_domain_dir "$domain"

  on_term() {
    aborted=1
    printf 'stopping' > "$(state_file "$domain")"

    if [[ -n "$child_pid" ]] && process_alive "$child_pid"; then
      kill -TERM "$child_pid" 2>/dev/null || true

      for _ in 1 2 3 4 5; do
        process_alive "$child_pid" || break
        sleep 1
      done

      if process_alive "$child_pid"; then
        kill -KILL "$child_pid" 2>/dev/null || true
      fi
    fi
  }

  trap on_term TERM INT

  case "$domain" in
    test|build)
      node "$SCRIPT_DIR/scripts/run-managed.mjs" "$domain" &
      ;;
    deps)
      bash "$SELF" __deps_exec "$action" &
      ;;
    *)
      exit 2
      ;;
  esac

  child_pid=$!
  printf 'running' > "$(state_file "$domain")"

  wait "$child_pid" || rc=$?

  if (( aborted == 1 )); then
    printf 'aborted' > "$(result_file "$domain")"
  elif (( rc == 0 )); then
    printf 'passed' > "$(result_file "$domain")"
  else
    printf 'failed' > "$(result_file "$domain")"
  fi

  if [[ "$domain" == "deps" ]]; then
    if dependencies_installed; then
      printf 'installed' > "$(state_file "$domain")"
    else
      printf 'not-installed' > "$(state_file "$domain")"
    fi
  else
    printf 'stopped' > "$(state_file "$domain")"
  fi

  rm -f "$(pid_file "$domain")"

  exit "$rc"
}

if [[ "${1:-}" == "__deps_exec" ]]; then
  [[ $# -eq 2 ]] || exit 2
  deps_exec "$2"
fi

if [[ "${1:-}" == "__runner" ]]; then
  [[ $# -ge 2 && $# -le 3 ]] || exit 2
  runner "$2" "${3:-start}"
fi

if [[ "${1:-}" == "data" ]]; then
  shift
  DATA_OPTION=""

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --option)
        [[ $# -ge 2 ]] || {
          printf 'ERROR: --option requires a value.\n' >&2
          exit 2
        }
        DATA_OPTION="$2"
        shift 2
        ;;
      *)
        printf 'ERROR: unknown argument "%s".\n' "$1" >&2
        exit 2
        ;;
    esac
  done

  run_data_domain "$DATA_OPTION"
  exit $?
fi

if [[ $# -lt 1 ]]; then
  usage
  exit 2
fi

DOMAIN="$1"
shift

case "$DOMAIN" in
 deps|test|build|dev|data)
    ;;
  *)
    usage
    exit 2
    ;;
esac

OPTION=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --option)
      [[ $# -ge 2 ]] || {
        printf 'ERROR: --option requires a value.\n' >&2
        exit 2
      }

      OPTION="$2"
      shift 2
      ;;
    *)
      printf 'ERROR: unknown argument "%s".\n' "$1" >&2
      exit 2
      ;;
  esac
done

STATUS="$(status_of "$DOMAIN")"

print_status "$DOMAIN"

read -r -a OPTIONS <<< "$(valid_options "$DOMAIN" "$STATUS")"

printf '\nAVAILABLE OPTIONS\n'

for i in "${!OPTIONS[@]}"; do
  printf '%d) %s\n' "$((i + 1))" "${OPTIONS[$i]}"
done

if [[ -z "$OPTION" ]]; then
  printf '\nSelect option: '
  read -r selection

  if [[ "$selection" =~ ^[0-9]+$ ]] &&
     (( selection >= 1 && selection <= ${#OPTIONS[@]} ))
  then
    OPTION="${OPTIONS[$((selection - 1))]}"
  else
    printf 'ERROR: invalid selection.\n' >&2
    exit 2
  fi
fi

if ! contains_option "$OPTION" "${OPTIONS[@]}"; then
  printf 'ERROR: option "%s" is not valid while %s is %s.\n' \
    "$OPTION" "$DOMAIN" "$STATUS" >&2
  exit 2
fi

case "$OPTION" in
  start)
    if [[ "$DOMAIN" == "dev" ]]; then
      run_dev_foreground
    else
      start_managed_domain "$DOMAIN" start
    fi
    ;;
  install)
    start_managed_domain "$DOMAIN" install
    ;;
  reinstall)
    start_managed_domain "$DOMAIN" reinstall
    ;;
  abort)
    stop_managed_domain "$DOMAIN" abort
    ;;
  stop)
    if [[ "$DOMAIN" != "dev" ]]; then
      printf 'ERROR: stop is only valid for the dev command.\n' >&2
      exit 2
    fi

    stop_dev_domain
    ;;
  exit)
    exit 0
    ;;
  *)
    printf 'ERROR: unsupported option "%s".\n' "$OPTION" >&2
    exit 2
    ;;
esac
