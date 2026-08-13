#!/usr/bin/env bash
set -euo pipefail

rp_id="${1:-login.microsoft.com}"
device="${2:-}"

need() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "missing required command: $1" >&2
    exit 1
  fi
}

need fido2-token
need fido2-assert
need node
need head
need base64

if [[ -z "$device" ]]; then
  device="$(fido2-token -L | awk -F: 'NF { print $1; exit }')"
fi

if [[ -z "$device" ]]; then
  echo "no FIDO2 device found" >&2
  exit 1
fi

workdir="$(mktemp -d /tmp/slacky-fido2-msft.XXXXXX)"
echo "device: $device"
echo "rp_id: $rp_id"
echo "workdir: $workdir"
echo

echo "Listing resident credentials for $rp_id."
echo "You may be prompted for your PIN."
fido2-token -L -k "$rp_id" "$device" | tee "$workdir/resident-creds.txt"

cred_id="$(awk '/^[[:space:]]*[0-9]+:/ { print $2; exit }' "$workdir/resident-creds.txt")"
if [[ -z "$cred_id" ]]; then
  echo "could not parse a credential id from resident credential listing" >&2
  exit 1
fi

echo
echo "Using first credential id from resident list:"
echo "$cred_id"
echo

head -c 32 /dev/urandom | base64 > "$workdir/client-data-hash.b64"

decode_flags() {
  local assert_file="$1"
  node - "$assert_file" <<'NODE'
const fs = require('fs');
const file = process.argv[2];
const lines = fs.readFileSync(file, 'utf8').trim().split(/\n/);
const cborAuthData = Buffer.from(lines[2], 'base64');
function unwrapCborByteString(buffer) {
  const majorType = buffer[0] >> 5;
  const additionalInfo = buffer[0] & 0x1f;
  if (majorType !== 2) return buffer;
  let offset = 1;
  let length = additionalInfo;
  if (additionalInfo === 24) {
    length = buffer[1];
    offset = 2;
  } else if (additionalInfo === 25) {
    length = buffer.readUInt16BE(1);
    offset = 3;
  } else if (additionalInfo === 26) {
    length = buffer.readUInt32BE(1);
    offset = 5;
  } else if (additionalInfo >= 27) {
    return buffer;
  }
  return buffer.length === offset + length ? buffer.subarray(offset) : buffer;
}
const authData = unwrapCborByteString(cborAuthData);
const flags = authData.length > 32 ? authData[32] : 0;
console.log(JSON.stringify({
  cborAuthenticatorDataBytes: cborAuthData.length,
  authenticatorDataBytes: authData.length,
  signatureBytes: Buffer.from(lines[3], 'base64').length,
  userHandleBytes: lines[4] ? Buffer.from(lines[4], 'base64').length : 0,
  flags: {
    value: `0x${flags.toString(16).padStart(2, '0')}`,
    up: Boolean(flags & 0x01),
    uv: Boolean(flags & 0x04),
  },
}, null, 2));
NODE
}

write_assert_input() {
  local file="$1"
  local include_cred="${2:-yes}"
  {
    cat "$workdir/client-data-hash.b64"
    echo "$rp_id"
    if [[ "$include_cred" == "yes" ]]; then
      echo "$cred_id"
    fi
  } > "$file"
}

echo "Fetching public key for local verification."
echo "You may be prompted for your PIN."
fido2-token -I -k "$rp_id" -i "$cred_id" "$device" > "$workdir/token-credential-info.txt"
tail -n +2 "$workdir/token-credential-info.txt" > "$workdir/public-key.pem"

echo
echo "Test 1: explicit credential assertion (-t up=true -t pin=true)."
echo "You should enter your PIN and touch the key."
write_assert_input "$workdir/assert-explicit.in" yes
fido2-assert -G -t up=true -t pin=true -i "$workdir/assert-explicit.in" "$device" \
  | tee "$workdir/assert-explicit.out" >/dev/null
decode_flags "$workdir/assert-explicit.out"
echo "Local verify with UP+UV required:"
if fido2-assert -V -p -v -i "$workdir/assert-explicit.out" "$workdir/public-key.pem" es256; then
  echo "verify: ok"
else
  echo "verify: failed"
fi

echo
echo "Test 2: resident assertion (-r -t up=true -t pin=true)."
echo "You should enter your PIN and touch the key."
write_assert_input "$workdir/assert-resident.in" no
fido2-assert -G -r -t up=true -t pin=true -i "$workdir/assert-resident.in" "$device" \
  | tee "$workdir/assert-resident.out" >/dev/null
decode_flags "$workdir/assert-resident.out"
head -n 4 "$workdir/assert-resident.out" > "$workdir/assert-resident-verify.in"
echo "Local verify with UP+UV required:"
if fido2-assert -V -p -v -i "$workdir/assert-resident-verify.in" "$workdir/public-key.pem" es256; then
  echo "verify: ok"
else
  echo "verify: failed"
fi

echo
echo "Done. Outputs are in $workdir"
