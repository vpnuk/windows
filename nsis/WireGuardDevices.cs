using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;

// SetupAPI includes non-present devices. No WMI/CIM provider or localized
// pnputil output is used to decide which devices may be removed.
public static class VpnukWireGuardDevices
{
    public sealed class Device
    {
        public string InstanceId;
        public string[] HardwareIds;
        public string Service;
        public Guid ClassGuid;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct DeviceInfo
    {
        public uint Size;
        public Guid ClassGuid;
        public uint DevInst;
        public IntPtr Reserved;
    }

    [DllImport("setupapi.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr SetupDiGetClassDevsW(IntPtr guid, string enumerator, IntPtr hwnd, uint flags);
    [DllImport("setupapi.dll", SetLastError = true)]
    private static extern bool SetupDiEnumDeviceInfo(IntPtr set, uint index, ref DeviceInfo info);
    [DllImport("setupapi.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool SetupDiGetDeviceInstanceIdW(IntPtr set, ref DeviceInfo info, StringBuilder id, uint length, out uint needed);
    [DllImport("setupapi.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool SetupDiGetDeviceRegistryPropertyW(IntPtr set, ref DeviceInfo info, uint property, out uint type, byte[] data, uint length, out uint needed);
    [DllImport("setupapi.dll", SetLastError = true)]
    private static extern bool SetupDiDestroyDeviceInfoList(IntPtr set);

    private static string[] Property(IntPtr set, ref DeviceInfo info, uint property)
    {
        byte[] buffer = new byte[8192];
        uint type, needed;
        if (!SetupDiGetDeviceRegistryPropertyW(set, ref info, property, out type, buffer, (uint)buffer.Length, out needed))
        {
            int error = Marshal.GetLastWin32Error();
            if (error == 13) return new string[0]; // property is not set
            throw new Win32Exception(error, "Cannot verify WireGuard device properties.");
        }
        return Encoding.Unicode.GetString(buffer, 0, (int)needed).Split(new char[] { '\0' }, StringSplitOptions.RemoveEmptyEntries);
    }

    public static Device[] Candidates()
    {
        // DIGCF_ALLCLASSES, intentionally not DIGCF_PRESENT.
        IntPtr set = SetupDiGetClassDevsW(IntPtr.Zero, null, IntPtr.Zero, 4);
        if (set == new IntPtr(-1)) throw new Win32Exception(Marshal.GetLastWin32Error());
        var devices = new List<Device>();
        try
        {
            for (uint index = 0; ; index++)
            {
                var info = new DeviceInfo();
                info.Size = (uint)Marshal.SizeOf(typeof(DeviceInfo));
                if (!SetupDiEnumDeviceInfo(set, index, ref info))
                {
                    int error = Marshal.GetLastWin32Error();
                    if (error == 259) break; // ERROR_NO_MORE_ITEMS, not an empty-on-error fallback
                    throw new Win32Exception(error, "Cannot enumerate Windows devices.");
                }
                uint needed;
                var id = new StringBuilder(4096);
                if (!SetupDiGetDeviceInstanceIdW(set, ref info, id, (uint)id.Capacity, out needed))
                    throw new Win32Exception(Marshal.GetLastWin32Error(), "Cannot read device identity.");
                string instance = id.ToString();
                if (!instance.StartsWith(@"ROOT\WIREGUARD\", StringComparison.OrdinalIgnoreCase) &&
                    !instance.StartsWith(@"SWD\WIREGUARD\", StringComparison.OrdinalIgnoreCase)) continue;
                string[] service = Property(set, ref info, 4); // SPDRP_SERVICE
                devices.Add(new Device {
                    InstanceId = instance, ClassGuid = info.ClassGuid,
                    HardwareIds = Property(set, ref info, 1), // SPDRP_HARDWAREID
                    Service = service.Length == 0 ? "" : service[0]
                });
            }
        }
        finally { SetupDiDestroyDeviceInfoList(set); }
        return devices.ToArray();
    }
}
