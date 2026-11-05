// Windows EAPHost generates the opaque method credential data; never construct
// undocumented EAP credential structures or write credentials to a PBK file.
using System;
using System.ComponentModel;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Security;

namespace VpnukIkev2
{
    public static class Credentials
    {
        [ComImport, Guid("2933BF80-7B36-11D2-B20E-00C04F983E60"),
         InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        public interface IXmlNode {}

        [StructLayout(LayoutKind.Sequential)]
        public struct MethodType
        {
            public byte Type;
            public uint VendorId;
            public uint VendorType;
            public uint AuthorId;
        }

        [DllImport("eappcfg.dll")]
        static extern uint EapHostPeerConfigXml2Blob(uint flags, IXmlNode doc,
            out uint size, out IntPtr data, out MethodType method, out IntPtr error);
        [DllImport("eappcfg.dll")]
        static extern uint EapHostPeerCredentialsXml2Blob(uint flags, IXmlNode doc,
            uint configSize, IntPtr config, out uint size, out IntPtr data,
            out MethodType method, out IntPtr error);
        [DllImport("eappcfg.dll")]
        static extern void EapHostPeerFreeMemory(IntPtr data);
        [DllImport("eappcfg.dll")]
        static extern void EapHostPeerFreeErrorMemory(IntPtr error);
        [DllImport("rasapi32.dll", CharSet = CharSet.Unicode)]
        static extern uint RasSetEapUserDataW(IntPtr token, string phonebook,
            string entry, IntPtr data, uint size);
        [DllImport("rasapi32.dll", CharSet = CharSet.Unicode)]
        static extern uint RasGetEapUserIdentityW(string phonebook, string entry,
            uint flags, IntPtr parent, out IntPtr identity);
        [DllImport("rasapi32.dll", CharSet = CharSet.Unicode)]
        static extern void RasFreeEapUserIdentityW(IntPtr identity);

        static object Xml(string xml)
        {
            var doc = Activator.CreateInstance(Type.GetTypeFromProgID("Msxml2.DOMDocument.6.0", true));
            try
            {
                bool loaded = (bool)doc.GetType().InvokeMember("loadXML",
                    BindingFlags.InvokeMethod, null, doc, new object[] { xml });
                if (!loaded) throw new InvalidOperationException("Invalid EAP XML");
                return doc;
            }
            catch { Marshal.FinalReleaseComObject(doc); throw; }
        }

        static void Check(uint code, string stage)
        {
            // Never include input, XML, or exception dumps in diagnostics.
            if (code != 0) throw new InvalidOperationException(stage + " failed (Windows code " + code + ")");
        }

        public static void Store(string phonebook, string entry, string configXml, string username, string password)
        {
            if (String.IsNullOrEmpty(username) || String.IsNullOrEmpty(password))
                throw new InvalidOperationException("VPNUK username and password are required");
            const string userNs = "http://www.microsoft.com/provisioning/EapHostUserCredentials";
            const string commonNs = "http://www.microsoft.com/provisioning/EapCommon";
            const string baseNs = "http://www.microsoft.com/provisioning/BaseEapUserPropertiesV1";
            const string mschapNs = "http://www.microsoft.com/provisioning/MsChapV2UserPropertiesV1";
            string userXml = "<EapHostUserCredentials xmlns=\"" + userNs + "\"><EapMethod>" +
                "<Type xmlns=\"" + commonNs + "\">26</Type><AuthorId xmlns=\"" + commonNs + "\">0</AuthorId>" +
                "</EapMethod><Credentials><Eap xmlns=\"" + baseNs + "\"><Type>26</Type>" +
                "<EapType xmlns=\"" + mschapNs + "\"><Username>" + SecurityElement.Escape(username) +
                "</Username><Password>" + SecurityElement.Escape(password) +
                "</Password><LogonDomain></LogonDomain></EapType></Eap></Credentials></EapHostUserCredentials>";
            object configDoc = null, userDoc = null;
            IntPtr config = IntPtr.Zero, credentials = IntPtr.Zero, error = IntPtr.Zero, identity = IntPtr.Zero;
            uint configSize = 0, credentialsSize = 0;
            MethodType method;
            try
            {
                configDoc = Xml(configXml);
                Check(EapHostPeerConfigXml2Blob(0, (IXmlNode)configDoc,
                    out configSize, out config, out method, out error), "EAP configuration conversion");
                if (method.Type != 26) throw new InvalidOperationException("Expected direct EAP-MSCHAPv2");
                if (error != IntPtr.Zero) { EapHostPeerFreeErrorMemory(error); error = IntPtr.Zero; }
                userDoc = Xml(userXml);
                Check(EapHostPeerCredentialsXml2Blob(0, (IXmlNode)userDoc, configSize, config,
                    out credentialsSize, out credentials, out method, out error), "EAP credential conversion");
                if (credentials == IntPtr.Zero || credentialsSize == 0)
                    throw new InvalidOperationException("Windows returned empty EAP credentials");
                Check(RasSetEapUserDataW(IntPtr.Zero, phonebook, entry, credentials, credentialsSize),
                    "Windows EAP credential storage");
                // Prove first-use identity retrieval needs no Windows dialogue.
                // RASEAPF_NonInteractive=0x2. This does not contact a VPN server.
                Check(RasGetEapUserIdentityW(phonebook, entry, 2, IntPtr.Zero, out identity),
                    "Non-interactive EAP identity preparation");
                if (identity == IntPtr.Zero || !String.Equals(Marshal.PtrToStringUni(identity), username, StringComparison.Ordinal))
                    throw new InvalidOperationException("Windows EAP identity does not match the supplied VPNUK account");
            }
            finally
            {
                if (identity != IntPtr.Zero) RasFreeEapUserIdentityW(identity);
                if (credentials != IntPtr.Zero)
                {
                    for (uint i = 0; i < credentialsSize; i++) Marshal.WriteByte(credentials, (int)i, 0);
                    EapHostPeerFreeMemory(credentials);
                }
                if (config != IntPtr.Zero) EapHostPeerFreeMemory(config);
                if (error != IntPtr.Zero) EapHostPeerFreeErrorMemory(error);
                if (userDoc != null) Marshal.FinalReleaseComObject(userDoc);
                if (configDoc != null) Marshal.FinalReleaseComObject(configDoc);
            }
        }
    }
}
