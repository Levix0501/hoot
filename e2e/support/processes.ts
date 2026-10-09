import { execFileSync } from 'node:child_process'
import psList from 'ps-list'

export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

async function processTable() {
  return psList({ all: false })
}

export async function parentPid(pid: number): Promise<number | undefined> {
  return (await processTable()).find((entry) => entry.pid === pid)?.ppid
}

export async function commandLine(pid: number): Promise<string | undefined> {
  return (await processTable()).find((entry) => entry.pid === pid)?.cmd
}

/** The chain of parent pids from `pid` up to launchd. */
export async function ancestors(pid: number): Promise<number[]> {
  const parents = new Map((await processTable()).map((entry) => [entry.pid, entry.ppid]))
  const chain: number[] = []
  for (let current = parents.get(pid); current !== undefined && current > 0;) {
    chain.push(current)
    current = parents.get(current)
  }
  return chain
}

export async function childPids(pid: number): Promise<number[]> {
  return (await processTable()).filter((entry) => entry.ppid === pid).map((entry) => entry.pid)
}

/** Files a process has open or mapped, including loaded native modules (from `lsof`). */
export function openFiles(pid: number): string[] {
  try {
    return execFileSync('lsof', ['-p', String(pid), '-Fn'], { encoding: 'utf8' })
      .split('\n')
      .filter((line) => line.startsWith('n'))
      .map((line) => line.slice(1))
  } catch {
    return []
  }
}
