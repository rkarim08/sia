#!/usr/bin/env bash
# Find which test pollutes another test by running bisection
# Usage: find-polluter.sh <test-command> <failing-test> [test-dir]
#
# Example:
#   find-polluter.sh "bun test" "src/auth/login.test.ts" "src/"
#
# Runs the failing test after each other test file individually
# to find which one leaves behind state that causes the failure.

set -euo pipefail

TEST_CMD="${1:?Usage: find-polluter.sh <test-command> <failing-test> [test-dir]}"
FAILING_TEST="${2:?Usage: find-polluter.sh <test-command> <failing-test> [test-dir]}"
TEST_DIR="${3:-.}"

# Discover all test files except the failing one
mapfile -t TEST_FILES < <(find "$TEST_DIR" -name "*.test.*" -o -name "*.spec.*" | grep -v "$FAILING_TEST" | sort)

echo "Searching ${#TEST_FILES[@]} test files for polluter of $FAILING_TEST"
echo "---"

# Verify the failing test actually fails in isolation first
if $TEST_CMD "$FAILING_TEST" &>/dev/null; then
  echo "The test passes when run alone — this IS a pollution issue."
else
  echo "The test fails even in isolation — not a pollution issue."
  echo "Debug the test itself, not other tests."
  exit 1
fi

# Bisection
lo=0
hi=$((${#TEST_FILES[@]} - 1))

while [ $lo -le $hi ]; do
  mid=$(( (lo + hi) / 2 ))
  subset=("${TEST_FILES[@]:0:$((mid+1))}")

  echo "Testing files 0..$mid (${#subset[@]} files)..."

  # Run subset + failing test together
  if $TEST_CMD "${subset[@]}" "$FAILING_TEST" &>/dev/null; then
    echo "  Pass — polluter is in files $((mid+1))..$hi"
    lo=$((mid + 1))
  else
    echo "  FAIL — polluter is in files $lo..$mid"
    hi=$((mid - 1))
  fi
done

if [ $lo -lt ${#TEST_FILES[@]} ]; then
  echo "---"
  echo "Found polluter: ${TEST_FILES[$lo]}"
  echo ""
  echo "Next steps:"
  echo "  1. Run: $TEST_CMD ${TEST_FILES[$lo]} $FAILING_TEST"
  echo "  2. Check what state ${TEST_FILES[$lo]} leaves behind"
  echo "  3. Add proper cleanup/teardown to the polluting test"
else
  echo "---"
  echo "Could not isolate a single polluter."
  echo "The pollution may require multiple tests interacting."
fi
