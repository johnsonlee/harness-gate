#!/usr/bin/env python3
"""Compare a contract with its committed baseline using the pinned external oasdiff CLI."""
import io
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import subprocess
import sys
import tarfile
import tempfile


def checked(command, cwd):
    result = subprocess.run(command, cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if result.returncode:
        raise RuntimeError(result.stderr.decode(errors='replace').strip() or f'{command[0]} failed')
    return result.stdout


def main():
    base = os.environ.get('HARNESS_BASE', '')
    contract = os.environ.get('HARNESS_CONTRACT', '')
    if not base or not contract:
        raise ValueError('HARNESS_BASE and HARNESS_CONTRACT are required')
    relative = PurePosixPath(contract)
    if relative.is_absolute() or '..' in relative.parts or not relative.parts:
        raise ValueError('HARNESS_CONTRACT must be a repository-relative file path')
    root = Path(checked(['git', 'rev-parse', '--show-toplevel'], Path.cwd()).decode().strip()).resolve()
    current = root.joinpath(*relative.parts)
    if not current.is_file() or not current.resolve().is_relative_to(root):
        raise ValueError(f'Contract is missing or outside repository: {contract}')
    revision = checked(['git', 'rev-parse', '--verify', '--end-of-options', base + '^{commit}'], root).decode().strip()
    executable = os.environ.get('HARNESS_OASDIFF', 'oasdiff')
    executable = shutil.which(executable)
    if not executable:
        raise ValueError('oasdiff is missing; install the pinned version in integrations/openapi/README.md')
    executable = str(Path(executable).resolve())
    with tempfile.TemporaryDirectory(prefix='harness-contract-') as directory:
        work = Path(directory)
        baseline = work / 'base'
        baseline.mkdir()
        # Archive the entire tree so local relative refs resolve against the BASE version.
        archive = checked(['git', 'archive', '--format=tar', revision], root)
        with tarfile.open(fileobj=io.BytesIO(archive)) as archive_file:
            for member in archive_file:
                name = PurePosixPath(member.name)
                if name.is_absolute() or '..' in name.parts:
                    raise ValueError('Unsafe path in baseline archive')
                destination = baseline.joinpath(*name.parts)
                if member.isdir():
                    destination.mkdir(parents=True, exist_ok=True)
                elif member.isfile():
                    destination.parent.mkdir(parents=True, exist_ok=True)
                    source = archive_file.extractfile(member)
                    if source is None:
                        raise ValueError(f'Cannot read baseline file {member.name}')
                    with source, destination.open('wb') as output:
                        shutil.copyfileobj(source, output)
                elif member.issym() or member.islnk():
                    # Do not follow baseline links into working-tree or host files.
                    # Unrelated links are omitted; a referenced link fails resolution.
                    continue
                else:
                    raise ValueError(f'Unsupported baseline archive member {member.name}')
        previous = baseline.joinpath(*relative.parts)
        if not previous.is_file():
            raise ValueError(f'Contract does not exist in baseline {revision}: {contract}')
        # Prevent implicit .oasdiff configuration from disabling the mandatory gate.
        config = work / 'oasdiff.json'
        config.write_text('{}')
        command = [executable, 'breaking', '--config', str(config), '--fail-on', 'WARN', '--format', 'json', str(previous), str(current)]
        print(f'Harness OpenAPI: baseline {revision}, contract {contract}', file=sys.stderr)
        result = subprocess.run(command, cwd=work)
        return result.returncode if result.returncode >= 0 else 2


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (OSError, ValueError, RuntimeError, tarfile.TarError) as error:
        print(f'Harness OpenAPI: error: {error}', file=sys.stderr)
        sys.exit(2)
