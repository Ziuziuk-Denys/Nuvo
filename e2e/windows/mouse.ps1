# Reads "move X Y" and "press" lines from stdin, in physical pixels, and answers each with one line.
$ErrorActionPreference = "Stop"
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class Mouse {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern int GetSystemMetrics(int index);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, int x, int y, uint data, UIntPtr extra);
}
"@
$MOVE_ABSOLUTE = 0x8001
$LEFT_DOWN = 0x2
$LEFT_UP = 0x4

[void][Mouse]::SetProcessDPIAware()
$width = [Mouse]::GetSystemMetrics(0) - 1
$height = [Mouse]::GetSystemMetrics(1) - 1
while ($null -ne ($line = [Console]::In.ReadLine())) {
  $words = $line.Trim().Split(" ")
  if ($words[0] -eq "move") {
    [Mouse]::mouse_event($MOVE_ABSOLUTE, [int]([int]$words[1] * 65535 / $width), [int]([int]$words[2] * 65535 / $height), 0, [UIntPtr]::Zero)
  } else {
    [Mouse]::mouse_event($LEFT_DOWN, 0, 0, 0, [UIntPtr]::Zero)
    Start-Sleep -Milliseconds 60
    [Mouse]::mouse_event($LEFT_UP, 0, 0, 0, [UIntPtr]::Zero)
  }
  [Console]::Out.WriteLine("ok")
  [Console]::Out.Flush()
}
