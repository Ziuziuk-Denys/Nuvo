# Presses the left button at a screen position given in physical pixels.
param([int]$X, [int]$Y)
$ErrorActionPreference = "Stop"
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class Press {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern int GetSystemMetrics(int index);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, int x, int y, uint data, UIntPtr extra);
}
"@
$MOVE_ABSOLUTE = 0x8001
$LEFT_DOWN = 0x2
$LEFT_UP = 0x4

[void][Press]::SetProcessDPIAware()
$across = [int]($X * 65535 / ([Press]::GetSystemMetrics(0) - 1))
$down = [int]($Y * 65535 / ([Press]::GetSystemMetrics(1) - 1))
[Press]::mouse_event($MOVE_ABSOLUTE, $across, $down, 0, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 500
[Press]::mouse_event($LEFT_DOWN, 0, 0, 0, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 60
[Press]::mouse_event($LEFT_UP, 0, 0, 0, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 300
