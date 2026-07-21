/** Parse the platform-specific /usr/bin/time maximum resident-set output into bytes. */
export function parseTimePeakRssBytes(output, platform) {
  if (platform === 'darwin') {
    const match = /^\s*(\d+)\s+maximum resident set size\s*$/imu.exec(output);
    return match?.[1] ? Number(match[1]) : undefined;
  }
  if (platform === 'linux') {
    const match = /Maximum resident set size \(kbytes\):\s*(\d+)/iu.exec(output);
    return match?.[1] ? Number(match[1]) * 1024 : undefined;
  }
  return undefined;
}
