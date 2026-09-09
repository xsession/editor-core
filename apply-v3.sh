#!/bin/sh
set -eu
SOURCE_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
TARGET=${1:-.}
mkdir -p "$TARGET/editor-core" "$TARGET/docs" "$TARGET/browser-benchmark"
cp "$SOURCE_DIR"/editor-core/* "$TARGET/editor-core/"
cp "$SOURCE_DIR"/docs/* "$TARGET/docs/"
cp -R "$SOURCE_DIR/browser-benchmark/." "$TARGET/browser-benchmark/"
cp -R "$SOURCE_DIR/python" "$TARGET/python"
echo "editor-core v3 patch applied to $TARGET"
