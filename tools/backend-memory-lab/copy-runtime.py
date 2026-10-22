"""Copy only executable sources/dependencies to the disposable ext4 data disk."""
import os
import shutil
import sys
from pathlib import Path

source = Path(__file__).resolve().parents[2]
target = Path('/var/tmp/maneki-backend-memory-lab/disk/runtime')
target.mkdir(parents=True, exist_ok=True)
parts = ['server', 'shared', 'framework/bridge', 'framework/packages', 'framework/node_modules',
         'framework/profiles', 'framework/scripts', 'framework/knowledge', 'framework/skills',
         'framework/package.json', 'framework/.dsh-home/profiles', 'tools/backend-memory-lab']
if '--finalize' not in sys.argv:
    for name in parts:
        origin, dest = source / name, target / name
        if origin.is_dir():
            shutil.copytree(origin, dest, symlinks=True, dirs_exist_ok=True)
        else:
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(origin, dest)
else:
    # After native Windows tar + Linux extraction, refresh only editable source.
    for name in ['server', 'shared', 'framework/bridge', 'framework/skills', 'framework/knowledge', 'tools/backend-memory-lab', 'framework/.dsh-home/profiles', 'app/src', 'docs/api', 'docs/product']:
        shutil.copytree(source / name, target / name, symlinks=True, dirs_exist_ok=True, ignore=shutil.ignore_patterns('node_modules'))
    shutil.copy2(source / 'README.md', target / 'README.md')
    shutil.copy2(source / 'tools/check-agent-http.mjs', target / 'tools/check-agent-http.mjs')
    shutil.copy2(source / 'tools/check-postgresql-integration.mjs', target / 'tools/check-postgresql-integration.mjs')
for base, dirs, files in os.walk(target):
    for name in dirs + files:
        path = Path(base) / name
        if path.is_symlink():
            link = os.readlink(path)
            if link.startswith(str(source)):
                replacement = str(target) + link[len(str(source)):]
                path.unlink()
                path.symlink_to(replacement)
for path in (target / 'framework/.dsh-home/profiles').rglob('*'):
    if path.is_file() and not path.is_symlink() and path.suffix in ['.yml', '.json']:
        value = path.read_text(encoding='utf-8')
        value = value.replace('C:/AI banking/Maneki-Neko', str(target)).replace('C:\\AI banking\\Maneki-Neko', str(target))
        value = value.replace('@deepseek-ai/dsh-sandbox-windows-acl', '@deepseek-ai/dsh-sandbox-local')
        path.write_text(value, encoding='utf-8')
for profile in ['luckycat', 'staff', 'staff-ops']:
    modules = target / 'framework/.dsh-home/profiles' / profile / 'node_modules'
    if modules.is_symlink():
        modules.unlink()
    elif modules.exists():
        assert modules.resolve().is_relative_to(target.resolve()) and modules.name == 'node_modules'
        shutil.rmtree(modules)
    modules.symlink_to(target / 'framework/node_modules', target_is_directory=True)
out = target / '.generated/backend-memory-lab'
out.mkdir(parents=True, exist_ok=True)
shutil.copy2(source / '.generated/backend-memory-lab/seed.json', out / 'seed.json')
shutil.copytree(source / '.generated/backend-memory-lab/before/server', out / 'before/server', symlinks=True, dirs_exist_ok=True)
shutil.copytree(source / '.generated/backend-memory-lab/before/shared', out / 'before/shared', symlinks=True, dirs_exist_ok=True)
print('Copied a separate Linux runtime to the 40 GiB ext4 disk; source workspace preserved.')
