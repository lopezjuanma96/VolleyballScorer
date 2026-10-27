#!/usr/bin/env bash
# Preserve exact remote tips as tags, then delete only unchanged branch refs.
set -euo pipefail
cd "$(dirname "$0")/.."
git fetch origin --prune
stamp=$(date +%Y-%m-%d)
branches=(redone python-gcp-firebase v0.4 v02)
args=()
leases=()
for branch in "${branches[@]}"; do
    ref="refs/remotes/origin/$branch"
    if ! git rev-parse --verify "$ref" >/dev/null 2>&1; then continue; fi
    sha=$(git rev-parse "$ref")
    tag="archive/$stamp/$branch"
    printf '%s\n' "$branch -> $tag ($sha)"
    if [[ ${1:-} == --apply ]]; then
        if git rev-parse --verify "refs/tags/$tag" >/dev/null 2>&1; then
            [[ $(git rev-parse "$tag^{commit}") == "$sha" ]] || { echo "Tag $tag ya existe con otro commit" >&2; exit 1; }
        else
            git tag -a "$tag" "$sha" -m "Archived $branch before unified deployment cleanup"
        fi
    fi
    args+=("refs/tags/$tag:refs/tags/$tag" ":refs/heads/$branch")
    leases+=("--force-with-lease=refs/heads/$branch:$sha")
done
if [[ ${1:-} != --apply ]]; then
    echo 'Vista previa. Usá --apply para publicar las etiquetas y retirar las ramas archivadas.'
    exit 0
fi
if (( ${#args[@]} == 0 )); then echo 'No quedan ramas antiguas para archivar.'; exit 0; fi
mkdir -p backups
git bundle create "backups/before-branch-archive-$stamp.bundle" --branches --remotes=origin --tags
# Atomic push: either every tag and branch deletion succeeds, or none does.
git push --atomic "${leases[@]}" origin "${args[@]}"
git fetch origin --prune
