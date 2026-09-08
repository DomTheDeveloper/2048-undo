"""One-time, lease-guarded cleanup of the explicitly reviewed 2048 branches."""
import json
import os
from pathlib import Path
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request


def git(*args):
    return subprocess.check_output(['git', *args], text=True).strip()


def main():
    repo = os.environ['GITHUB_REPOSITORY']
    token = os.environ['GH_TOKEN']
    expected_head = os.environ['GITHUB_SHA']
    manifest = json.loads(Path('maintenance/branch-consolidation-20260908.json').read_text())
    reviewed = manifest['reviewed_branch_tips']
    canonical = manifest['canonical_branch']
    assert canonical == 'gh-pages' and canonical not in reviewed
    assert os.environ['GITHUB_REF'] == 'refs/heads/gh-pages'
    assert git('rev-parse', 'HEAD') == expected_head
    report = {'reviewed_tips': reviewed, 'integration_commit': expected_head, 'cancelled_runs': []}

    def api(path='', method='GET', payload=None):
        body = None if payload is None else json.dumps(payload).encode()
        request = urllib.request.Request(
            'https://api.github.com/repos/' + repo + path,
            data=body, method=method,
            headers={'Authorization': 'Bearer ' + token,
                     'Accept': 'application/vnd.github+json',
                     'Content-Type': 'application/json',
                     'User-Agent': '2048-reviewed-branch-consolidation'})
        with urllib.request.urlopen(request, timeout=45) as response:
            content = response.read()
            return json.loads(content) if content else None

    def remote_heads():
        result = {}
        for line in git('ls-remote', '--heads', 'origin').splitlines():
            sha, ref = line.split()
            result[ref.removeprefix('refs/heads/')] = sha
        return result

    def check_tips(head):
        refs = remote_heads()
        assert refs.get(canonical) == head, 'Canonical branch advanced; refusing stale maintenance.'
        unknown = set(refs) - set(reviewed) - {canonical}
        assert not unknown, 'Unreviewed new branches: ' + repr(unknown)
        for branch, sha in reviewed.items():
            assert refs.get(branch) == sha, 'Branch changed or disappeared: ' + branch
            subprocess.run(['git', 'merge-base', '--is-ancestor', sha, 'HEAD'], check=True)
        return refs

    check_tips(expected_head)
    # Stop obsolete writers BEFORE deleting their branch names, preventing recreation.
    active = []
    page = 1
    while True:
        runs = api('/actions/runs?per_page=100&page=' + str(page))['workflow_runs']
        for run in runs:
            if run['head_branch'] in reviewed and run['status'] != 'completed':
                active.append(run['id'])
        if len(runs) < 100:
            break
        page += 1
        assert page <= 50, 'Unexpectedly large run history; refusing incomplete audit.'
    for run_id in active:
        if api('/actions/runs/' + str(run_id))['status'] != 'completed':
            try:
                api('/actions/runs/' + str(run_id) + '/cancel', 'POST')
            except urllib.error.HTTPError as exc:
                if api('/actions/runs/' + str(run_id))['status'] != 'completed':
                    raise RuntimeError('Cannot stop obsolete workflow ' + str(run_id)) from exc
        report['cancelled_runs'].append(run_id)
    for _ in range(60):
        pending = [r for r in active if api('/actions/runs/' + str(r))['status'] != 'completed']
        if not pending:
            break
        time.sleep(2)
    else:
        raise RuntimeError('Obsolete writers still active; no branches deleted: ' + repr(pending))
    check_tips(expected_head)

    # Update current navigation only. Historical audit/source records stay byte-identical.
    p = Path('README.md')
    text = p.read_text().replace('https://domthedeveloper.github.io/2048-undo/',
                               'https://domthedeveloper.github.io/2048/')
    text = text.replace('request to pull into `master`', 'request to pull into `gh-pages`')
    p.write_text(text)
    p = Path('CONTRIBUTING.md')
    p.write_text('## Contributing\n\nChanges and improvements are welcome. Fork the repository, make your changes in a feature branch in your fork, and open a pull request targeting `gh-pages`. This repository uses `gh-pages` as its canonical development and publication branch. Please run the relevant game, witness, research and proof checks before submitting changes.\n')
    p = Path('CITATION.cff')
    text = p.read_text().replace('DomTheDeveloper/2048-undo', 'DomTheDeveloper/2048')
    text = text.replace('/blob/claude/super-mode-speed-corners-doxfcj/', '/blob/gh-pages/')
    p.write_text(text)
    subprocess.run(['git', 'config', 'user.name', 'github-actions[bot]'], check=True)
    subprocess.run(['git', 'config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com'], check=True)
    subprocess.run(['git', 'add', 'README.md', 'CONTRIBUTING.md', 'CITATION.cff'], check=True)
    subprocess.run(['git', 'diff', '--cached', '--check'], check=True)
    if subprocess.run(['git', 'diff', '--cached', '--quiet']).returncode:
        subprocess.run(['git', 'commit', '-m', 'Point contribution and citation links at canonical gh-pages in renamed 2048 repository'], check=True)
        subprocess.run(['git', 'push', 'origin', 'HEAD:refs/heads/gh-pages'], check=True)
    current = git('rev-parse', 'HEAD')
    check_tips(current)

    default = api()['default_branch']
    if default != canonical:
        try:
            default = api('', 'PATCH', {'default_branch': canonical})['default_branch']
        except urllib.error.HTTPError as exc:
            if exc.code != 403:
                raise
            report['default_branch_change'] = 'HTTP 403: repository-administration permission required'
            print('::warning::Cannot change default branch with this credential; preserving the existing default branch.')
            default = api()['default_branch']
    check_tips(current)
    deletions = [branch for branch in reviewed if branch != default]
    leases = ['--force-with-lease=refs/heads/' + branch + ':' + reviewed[branch] for branch in deletions]
    refspecs = [':refs/heads/' + branch for branch in deletions]
    if deletions:
        subprocess.run(['git', 'push', '--atomic', *leases, 'origin', *refspecs], check=True)
    remaining = remote_heads()
    assert canonical in remaining
    assert all(branch not in remaining for branch in deletions)
    report.update({'deleted_branches': deletions, 'remaining_branches': remaining,
                   'default_branch': api()['default_branch'], 'canonical_commit': current})
    output = Path(os.environ['RUNNER_TEMP']) / 'consolidation' / 'branch-cleanup.json'
    output.write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report, indent=2), flush=True)


if __name__ == '__main__':
    main()
