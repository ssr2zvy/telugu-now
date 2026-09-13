#!/bin/sh
set -eu

fail() {
  printf 'Container initialization failed: %s\n' "$1" >&2
  exit 1
}

[ "$#" -gt 0 ] || fail "No application command was supplied."
DATA_DIRECTORY="${DATA_DIRECTORY-/data}"
[ -n "$DATA_DIRECTORY" ] || fail "DATA_DIRECTORY must not be empty."
data_root="$(realpath -ms -- "$DATA_DIRECTORY")"
[ "$data_root" != "/" ] || fail "DATA_DIRECTORY must not be the filesystem root."
[ "$(realpath -m -- "$data_root")" = "$data_root" ] \
  || fail "DATA_DIRECTORY must not contain symbolic links."
export DATA_DIRECTORY="$data_root"

# Validate every managed directory before changing any ownership.
for directory in "$data_root" "$data_root/corpus" "$data_root/user" "$data_root/word-images"; do
  [ ! -L "$directory" ] || fail "Managed data directories must not be symbolic links: $directory"
  if [ -e "$directory" ] && [ ! -d "$directory" ]; then
    fail "Expected a data directory: $directory"
  fi
done

uid="$(id -u)"
for directory in "$data_root" "$data_root/corpus" "$data_root/user" "$data_root/word-images"; do
  mkdir -p -- "$directory"
  if [ "$uid" = "0" ]; then
    chown -h node:node -- "$directory"
  elif [ ! -w "$directory" ] || [ ! -x "$directory" ]; then
    fail "Data directory must be writable and searchable by the application user: $directory"
  fi
done

if [ "$uid" = "0" ]; then
  # Recheck directory access as the application user before starting the server.
  exec gosu node "$0" "$@"
fi

exec "$@"
