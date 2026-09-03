#!/usr/bin/env bash
set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

RUNTIME_DIR="$SCRIPT_DIR/.control-project"
mkdir -p "$RUNTIME_DIR"

usage() {
  cat <<'USAGE'
Usage:
  ./control-project.sh deps [--option install|reinstall|abort|exit]
  ./control-project.sh test [--option start|abort|exit]
  ./control-project.sh build [--option start|abort|exit]
  ./control-project.sh dev [--option start|stop|exit]
USAGE
}

domain_dir() { printf '%s/%s' "$RUNTIME_DIR" "$1"; }
pid_file() { printf '%s/pid' "$(domain_dir "$1")"; }
state_file() { printf '%s/state' "$(domain_dir "$1")"; }
result_file() { printf '%s/result' "$(domain_dir "$1")"; }
log_file() { printf '%s/%s.log' "$RUNTIME_DIR" "$1"; }
lock_dir() { printf '%s/%s.lock' "$RUNTIME_DIR" "$1"; }

ensure_domain_dir() { mkdir -p "$(domain_dir "$1")"; }

read_file_or() {
  local file="$1" fallback="$2"
  if [[ -f "$file" ]]; then cat "$file"; else printf '%s' "$fallback"; fi
}

process_alive() {
  local pid="$1"
  kill -0 "$pid" 2>/dev/null
}

process_is_ours() {
  local pid="$1" domain="$2" command
  command="$(ps -p "$pid" -o command= 2>/dev/null || true)"
  [[ "$command" == *"control-project.sh __runner $domain"* ]]
}

dependencies_installed() {
  [[ -d "$SCRIPT_DIR/node_modules" ]] || return 1
  npm ls --depth=0 --silent >/dev/null 2>&1
}

status_of() {
  local domain="$1" pf pid sf stored dependency_status
  ensure_domain_dir "$domain"
  pf="$(pid_file "$domain")"
  sf="$(state_file "$domain")"

  if [[ -f "$pf" ]]; then
    pid="$(cat "$pf" 2>/dev/null || true)"
    if [[ "$pid" =~ ^[0-9]+$ ]] && process_alive "$pid" && process_is_ours "$pid" "$domain"; then
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
  local domain="$1" status result pid
  status="$(status_of "$domain")"

  printf '%s STATUS\n' "$(printf '%s' "$domain" | tr '[:lower:]' '[:upper:]')"
  printf 'Status: %s\n' "$status"

  if [[ "$status" == "starting" || "$status" == "running" || "$status" == "stopping" ]]; then
    if [[ -f "$(pid_file "$domain")" ]]; then
      pid="$(cat "$(pid_file "$domain")")"
      printf 'PID: %s\n' "$pid"
    fi
  fi

  if [[ "$domain" != "dev" && -f "$(result_file "$domain")" ]]; then
    result="$(cat "$(result_file "$domain")")"
    printf 'Last result: %s\n' "$result"
  fi
}

valid_options() {
  local domain="$1" status="$2"

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
  local domain="$1" lock
  lock="$(lock_dir "$domain")"

  if ! mkdir "$lock" 2>/dev/null; then
    printf 'ERROR: another control action for "%s" is already in progress.\n' "$domain" >&2
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

start_domain() {
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

  if [[ "$domain" == "dev" ]]; then
    printf 'starting' > "$sf"
  else
    printf 'running' > "$sf"
  fi

  nohup "$SCRIPT_DIR/control-project.sh" \
    __runner "$domain" "$action" \
    >> "$lf" 2>&1 &

  runner_pid=$!
  printf '%s' "$runner_pid" > "$pf"

  release_lock

  printf 'Started %s %s (PID %s).\n' "$domain" "$action" "$runner_pid"
}

stop_domain() {
  local domain="$1" action="$2" status pid

  acquire_lock "$domain" || return 1
  status="$(status_of "$domain")"

  if [[ "$status" != "starting" && "$status" != "running" && "$status" != "stopping" ]]; then
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

wait_for_dev_ready() {
  local child_pid="$1" attempts=0

  while (( attempts < 60 )); do
    if ! process_alive "$child_pid"; then
      return 1
    fi

    if node -e \
      "fetch('http://127.0.0.1:5173/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" \
      >/dev/null 2>&1
    then
      return 0
    fi

    sleep 0.5
    attempts=$((attempts + 1))
  done

  return 1
}

deps_exec() {
  local action="$1"

  # If no lockfile exists, a reinstall must remove the existing dependency
  # tree first because npm install itself is not a clean install.
  if [[ "$action" == "reinstall" && ! -f "$SCRIPT_DIR/package-lock.json" ]]; then
    rm -rf "$SCRIPT_DIR/node_modules"
  fi

  # Once a lockfile exists, use npm ci so the dependency tree is installed
  # exactly from the committed lockfile.
  if [[ -f "$SCRIPT_DIR/package-lock.json" ]]; then
    exec npm ci
  fi

  # The first successful install creates package-lock.json.
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
    test|build|dev)
      node "$SCRIPT_DIR/scripts/run-managed.mjs" "$domain" &
      ;;
    deps)
      "$SCRIPT_DIR/control-project.sh" __deps_exec "$action" &
      ;;
    *)
      exit 2
      ;;
  esac

  child_pid=$!

  if [[ "$domain" == "dev" ]]; then
    if wait_for_dev_ready "$child_pid"; then
      printf 'running' > "$(state_file "$domain")"
    else
      if process_alive "$child_pid"; then
        kill -TERM "$child_pid" 2>/dev/null || true
      fi
    fi
  else
    printf 'running' > "$(state_file "$domain")"
  fi

  wait "$child_pid" || rc=$?

  if (( aborted == 1 )); then
    if [[ "$domain" != "dev" ]]; then
      printf 'aborted' > "$(result_file "$domain")"
    fi
  elif [[ "$domain" != "dev" ]]; then
    if (( rc == 0 )); then
      printf 'passed' > "$(result_file "$domain")"
    else
      printf 'failed' > "$(result_file "$domain")"
    fi
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

if [[ $# -lt 1 ]]; then
  usage
  exit 2
fi

DOMAIN="$1"
shift

case "$DOMAIN" in
  deps|test|build|dev)
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
    start_domain "$DOMAIN" start
    ;;
  install)
    start_domain "$DOMAIN" install
    ;;
  reinstall)
    start_domain "$DOMAIN" reinstall
    ;;
  abort)
    stop_domain "$DOMAIN" abort
    ;;
  stop)
    stop_domain "$DOMAIN" stop
    ;;
  exit)
    exit 0
    ;;
  *)
    printf 'ERROR: unsupported option "%s".\n' "$OPTION" >&2
    exit 2
    ;;
esac