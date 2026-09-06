#!/usr/bin/env python3
"""Run against the real oasdiff executable: HARNESS_OASDIFF=/path/to/oasdiff python3 ..."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

CHECK = Path(__file__).with_name('check.py').resolve()


def git(root, *args):
    subprocess.run(['git', *args], cwd=root, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)


def run(root, expect, **override):
    env = {**os.environ, 'HARNESS_BASE': 'HEAD', 'HARNESS_CONTRACT': 'contracts/api spec.json', **override}
    result = subprocess.run([sys.executable, str(CHECK)], cwd=root, env=env, capture_output=True, text=True)
    assert (result.returncode == 0) == expect, result.stdout + result.stderr
    return result


with tempfile.TemporaryDirectory(prefix='harness-openapi-test-') as directory:
    root = Path(directory)
    git(root, 'init', '-q')
    git(root, 'config', 'user.email', 'fixture@example.invalid')
    git(root, 'config', 'user.name', 'Harness Fixture')
    contract = root / 'contracts/api spec.json'
    contract.parent.mkdir()
    schema = root / 'contracts/schema.json'
    spec = {'openapi': '3.0.3', 'info': {'title': 'Fixture', 'version': '1.0.0'}, 'paths': {'/items': {'get': {'responses': {'200': {'description': 'ok', 'content': {'application/json': {'schema': {'$ref': 'schema.json'}}}}}}}}}
    contract.write_text(json.dumps(spec))
    schema.write_text(json.dumps({'type': 'object', 'properties': {'id': {'type': 'string'}}}))
    git(root, 'add', '.')
    git(root, 'commit', '-qm', 'baseline')
    run(root, True)
    spec['info']['description'] = 'Documentation addition'
    contract.write_text(json.dumps(spec))
    run(root, True)
    # Only the relative reference changes: proves baseline refs were not read from HEAD's working tree.
    schema.write_text(json.dumps({'type': 'object', 'properties': {'id': {'type': 'integer'}}}))
    assert 'response-property-type-changed' in run(root, False).stdout
    schema.write_text(json.dumps({'type': 'object', 'properties': {'id': {'type': 'string'}}}))
    spec['paths'] = {}
    contract.write_text(json.dumps(spec))
    removed = run(root, False)
    assert 'api-path-removed-without-deprecation' in removed.stdout, removed.stdout + removed.stderr
    contract.unlink()
    assert 'missing' in run(root, False).stderr
    contract.write_text(json.dumps(spec))
    assert 'required' in run(root, False, HARNESS_BASE='').stderr
    assert run(root, False, HARNESS_BASE='--help').returncode != 0
    assert 'missing' in run(root, False, HARNESS_OASDIFF='/does/not/exist').stderr
    new = root / 'new.json'
    new.write_text(json.dumps(spec))
    assert 'does not exist in baseline' in run(root, False, HARNESS_CONTRACT='new.json').stderr
    assert 'repository-relative' in run(root, False, HARNESS_CONTRACT='../outside.json').stderr
    print('PASS real oasdiff: compatible change, breaking endpoint, baseline-local refs, spaces, missing files/base/tool, unsafe input')
