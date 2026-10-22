#!/usr/bin/env python3
"""Store the production OpenAI key without echoing it or putting it in argv.

Run personally in a terminal, or provide --key-file with a private local file.
This changes only /prod/30grow/openai; it does not restart/deploy the service.
"""
import argparse
import getpass
import json
import os
from pathlib import Path
import subprocess
import tempfile

REGION = 'us-west-2'
ACCOUNT = '669241375557'
SECRET = '/prod/30grow/openai'


def aws(*args):
    return subprocess.run(['aws', *args, '--region', REGION, '--output', 'json', '--no-cli-pager'],
                          text=True, capture_output=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--key-file', type=Path)
    args = parser.parse_args()
    identity = aws('sts', 'get-caller-identity')
    if identity.returncode or json.loads(identity.stdout).get('Account') != ACCOUNT:
        raise SystemExit('Sessão AWS inválida ou conta incorreta. Execute aws login.')
    if args.key_file:
        value = args.key_file.read_text().strip()
        if value.startswith('{'):
            value = json.loads(value)['OPENAI_API_KEY'].strip()
        elif value.startswith('OPENAI_API_KEY='):
            value = value.split('=', 1)[1].strip().strip('\"\'')
    else:
        value = getpass.getpass('Nova OPENAI_API_KEY (entrada oculta): ').strip()
    if not value.startswith('sk-') or any(c.isspace() for c in value):
        raise SystemExit('Formato de chave inválido; nenhuma alteração foi enviada.')
    exists = aws('secretsmanager', 'describe-secret', '--secret-id', SECRET)
    if exists.returncode and 'ResourceNotFoundException' not in exists.stderr:
        raise SystemExit('Não foi possível consultar o segredo; nenhuma alteração enviada.')
    fd, path = tempfile.mkstemp(prefix='30grow-openai-', suffix='.json')
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, 'w') as f:
            json.dump({'OPENAI_API_KEY': value}, f)
        if exists.returncode:
            result = aws('secretsmanager', 'create-secret', '--name', SECRET,
                         '--description', 'Production 30Grow OpenAI API key',
                         '--secret-string', 'file://' + path)
        else:
            result = aws('secretsmanager', 'put-secret-value', '--secret-id', SECRET,
                         '--secret-string', 'file://' + path)
        if result.returncode:
            raise SystemExit('Falha ao gravar no Secrets Manager. A chave não foi exibida.')
        metadata = json.loads(result.stdout)
        print(json.dumps({'secret': SECRET, 'arn': metadata['ARN'],
                          'version_id': metadata['VersionId'], 'stored': True,
                          'deployment_required': True}, indent=2))
    finally:
        os.unlink(path)


if __name__ == '__main__':
    main()
