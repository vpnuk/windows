using System;
using System.Management.Automation;
using System.Net;
using DotRas;

namespace VpnHelper
{
    [Cmdlet(VerbsCommunications.Connect, "Vpn")]
    public class ConnectVpnCommand : PSCmdlet
    {
        [Parameter(
            Mandatory = true,
            Position = 0,
            ValueFromPipeline = true,
            ValueFromPipelineByPropertyName = true)]
        public string EntryName { get; set; }

        [Parameter(
            Mandatory = true,
            Position = 1,
            ValueFromPipeline = true,
            ValueFromPipelineByPropertyName = true)]
        public string Username { get; set; }

        [Parameter(
            Mandatory = true,
            Position = 2,
            ValueFromPipeline = true,
            ValueFromPipelineByPropertyName = true)]
        public string Password { get; set; }

        private RasDialer _dialer;

        protected override void BeginProcessing()
        {
            _dialer = new RasDialer();
        }

        protected override void ProcessRecord()
        {
            try
            {
                _dialer.EntryName = EntryName;
                _dialer.Credentials = new NetworkCredential(Username, Password);
                WriteObject("Connecting...");
                
                var connection = _dialer.Connect();
                
                WriteObject($"Connected to {connection.EntryName}");
            }
            catch (Exception ex)
            {
                WriteObject($"Error: {ex.Message}");
            }
        }
    }
}
