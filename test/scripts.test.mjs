import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const installPath = new URL('../scripts/install-task.ps1', import.meta.url);
const uninstallPath = new URL('../scripts/uninstall-task.ps1', import.meta.url);

test('scheduled task scripts share one stable task name', () => {
  const install = fs.readFileSync(installPath, 'utf8');
  const uninstall = fs.readFileSync(uninstallPath, 'utf8');

  assert.match(install, /ShanZhuInsightDailyCollection/);
  assert.match(uninstall, /ShanZhuInsightDailyCollection/);
});

test('installer uses an absolute quoted CLI path and daily interactive trigger', () => {
  const install = fs.readFileSync(installPath, 'utf8');

  assert.match(install, /GetFullPath/);
  assert.match(install, /Get-Command\s+node[\s\S]*Select-Object\s+-First\s+1\s+-ExpandProperty\s+Source/);
  assert.match(install, /src[\\/]cli\.mjs/);
  assert.match(install, /["']\{0\}["'] collect/);
  assert.match(install, /New-ScheduledTaskTrigger[\s\S]*-Daily/);
  assert.match(install, /New-ScheduledTaskPrincipal[\s\S]*-LogonType\s+Interactive/);
  assert.match(install, /-RunLevel\s+Limited/);
  assert.match(install, /Register-ScheduledTask[\s\S]*-Force/);
});

test('uninstaller removes only the stable task without prompting', () => {
  const uninstall = fs.readFileSync(uninstallPath, 'utf8');

  assert.match(uninstall, /Unregister-ScheduledTask/);
  assert.match(uninstall, /-Confirm:\$false/);
});
