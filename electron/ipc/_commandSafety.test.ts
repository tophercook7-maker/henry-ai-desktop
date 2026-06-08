import { describe, it, expect } from 'vitest';
import { classifyCommand, isDangerousCommand } from './_commandSafety';

describe('classifyCommand — blocks catastrophic commands', () => {
  const blocked: Array<[string, string]> = [
    ['rm -rf /', 'classic root wipe'],
    ['rm -rf /*', 'root glob wipe'],
    ['rm -fr /', 'reversed flags'],
    ['rm -rf  /', 'extra spaces'],
    ['RM -RF /', 'uppercase'],
    ['rm -r -f /', 'split flags'],
    ['rm --recursive --force /', 'long flags'],
    ['rm -rf ~', 'home dir'],
    ['rm -rf ~/', 'home dir slash'],
    ['rm -rf $HOME', 'home env var'],
    ['rm -rf /usr', 'system root usr'],
    ['rm -rf /etc/*', 'system root etc glob'],
    ['rm -rf /System', 'macOS System'],
    ['rm -rf /Users', 'all users'],
    ['rm -rf .', 'current dir'],
    ['rm -rf *', 'bare glob'],
    ['sudo rm -rf /', 'with sudo prefix'],
    ['echo hi && rm -rf /', 'chained after &&'],
    ['echo hi; rm -rf ~', 'chained after ;'],
    [':(){:|:&};:', 'fork bomb'],
    [':(){ :|:& };:', 'fork bomb spaced'],
    ['mkfs.ext4 /dev/sda1', 'format filesystem'],
    ['dd if=/dev/zero of=/dev/sda', 'dd to device'],
    ['cat foo > /dev/sda', 'redirect to raw disk'],
    ['shutdown -h now', 'shutdown'],
    ['sudo reboot', 'reboot'],
    ['halt', 'halt'],
  ];

  it.each(blocked)('blocks %j (%s)', (cmd) => {
    const verdict = classifyCommand(cmd);
    expect(verdict.blocked, `expected to block: ${cmd}`).toBe(true);
    expect(verdict.reason).toBeTruthy();
  });
});

describe('classifyCommand — allows ordinary commands', () => {
  const allowed = [
    'ls -la',
    'git status',
    'npm install',
    'rm -rf node_modules',
    'rm -rf ./build',
    'rm -rf dist',
    'rm file.txt',
    'rm -r ./tmp', // recursive but not forced, and a non-root target
    'mkdir -p src/components',
    'cat package.json',
    'find . -name "*.ts"',
    'node script.js',
    'python3 build.py',
  ];

  it.each(allowed)('allows %j', (cmd) => {
    expect(isDangerousCommand(cmd), `expected to allow: ${cmd}`).toBe(false);
  });

  it('does not block deletes of named project folders', () => {
    expect(isDangerousCommand('rm -rf node_modules .next dist')).toBe(false);
  });

  it('handles empty / whitespace input', () => {
    expect(isDangerousCommand('')).toBe(false);
    expect(isDangerousCommand('   ')).toBe(false);
  });
});
