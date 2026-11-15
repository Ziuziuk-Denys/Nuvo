# Opens a borderless window over the primary screen from a second process, then reports whether the Notch is above it.
param([switch]$TopMost)
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class ZOrder {
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr FindWindow(string className, string title);
  [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr window, uint command);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr window);
  [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr window, int index);
}
"@
$GW_HWNDPREV = 3
$GWL_EXSTYLE = -20
$WS_EX_TOPMOST = 0x8

$cover = New-Object System.Windows.Forms.Form
$cover.Text = "Nuvo z-order cover"
$cover.FormBorderStyle = "None"
$cover.StartPosition = "Manual"
$cover.Bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$cover.TopMost = $TopMost
$cover.Show()
$cover.Activate()
$until = (Get-Date).AddSeconds(3)
while ((Get-Date) -lt $until) {
  [System.Windows.Forms.Application]::DoEvents()
  Start-Sleep -Milliseconds 50
}

# PowerShell would pass $null as an empty class name
$notch = [ZOrder]::FindWindow([NullString]::Value, "Nuvo Notch")
if ($notch -eq [IntPtr]::Zero) { Write-Output "notch missing"; $cover.Close(); exit 0 }
$visible = [ZOrder]::IsWindowVisible($notch)
$topmost = ([ZOrder]::GetWindowLong($notch, $GWL_EXSTYLE) -band $WS_EX_TOPMOST) -ne 0
$result = "notch above"
$window = [ZOrder]::GetWindow($notch, $GW_HWNDPREV)
while ($window -ne [IntPtr]::Zero) {
  if ($window -eq $cover.Handle) { $result = "cover above"; break }
  $window = [ZOrder]::GetWindow($window, $GW_HWNDPREV)
}
$cover.Close()
Write-Output "$result (notch visible=$visible topmost=$topmost)"
