using System;
using System.IO;
using System.Text;

// BLAKE2b-256, the unkeyed digest used by WireGuard's latest.sig manifest.
// RFC 7693 sections 2 and 3. Windows PowerShell 5/.NET Framework does not
// provide this digest through Get-FileHash. Do not truncate a BLAKE2b-512 hash:
// the digest length is part of BLAKE2's initialization parameters.
public static class VpnukWireGuardHash
{
    private static readonly ulong[] Initial = {
        0x6a09e667f3bcc908UL, 0xbb67ae8584caa73bUL,
        0x3c6ef372fe94f82bUL, 0xa54ff53a5f1d36f1UL,
        0x510e527fade682d1UL, 0x9b05688c2b3e6c1fUL,
        0x1f83d9abfb41bd6bUL, 0x5be0cd19137e2179UL
    };
    private static readonly byte[,] Sigma = {
        {0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15},
        {14,10,4,8,9,15,13,6,1,12,0,2,11,7,5,3},
        {11,8,12,0,5,2,15,13,10,14,3,6,7,1,9,4},
        {7,9,3,1,13,12,11,14,2,6,5,10,4,0,15,8},
        {9,0,5,7,2,4,10,15,14,1,11,12,6,8,3,13},
        {2,12,6,10,0,11,8,3,4,13,7,5,15,14,1,9},
        {12,5,1,15,14,13,4,10,0,7,6,3,9,2,8,11},
        {13,11,7,14,12,1,3,9,5,0,15,4,8,6,2,10},
        {6,15,14,9,11,3,0,8,12,2,13,7,1,4,10,5},
        {10,2,8,4,7,6,1,5,15,11,9,14,3,12,13,0}
    };
    private static ulong Rotate(ulong value, int count)
    {
        return (value >> count) | (value << (64 - count));
    }
    private static void Mix(ulong[] v, int a, int b, int c, int d, ulong x, ulong y)
    {
        unchecked {
            v[a] += v[b] + x; v[d] = Rotate(v[d] ^ v[a], 32);
            v[c] += v[d]; v[b] = Rotate(v[b] ^ v[c], 24);
            v[a] += v[b] + y; v[d] = Rotate(v[d] ^ v[a], 16);
            v[c] += v[d]; v[b] = Rotate(v[b] ^ v[c], 63);
        }
    }
    private static void Compress(ulong[] h, byte[] block, ulong count, bool final)
    {
        var m = new ulong[16];
        var v = new ulong[16];
        for (int i = 0; i < 16; i++)
            for (int j = 0; j < 8; j++) m[i] |= (ulong)block[i * 8 + j] << (8 * j);
        Array.Copy(h, v, 8);
        Array.Copy(Initial, 0, v, 8, 8);
        v[12] ^= count;
        // A .NET file's length is a signed 64-bit value, so the high counter
        // word is zero for every file representable by this streaming API.
        if (final) v[14] = ~v[14];
        for (int round = 0; round < 12; round++) {
            int s = round % 10;
            Mix(v,0,4,8,12,m[Sigma[s,0]],m[Sigma[s,1]]);
            Mix(v,1,5,9,13,m[Sigma[s,2]],m[Sigma[s,3]]);
            Mix(v,2,6,10,14,m[Sigma[s,4]],m[Sigma[s,5]]);
            Mix(v,3,7,11,15,m[Sigma[s,6]],m[Sigma[s,7]]);
            Mix(v,0,5,10,15,m[Sigma[s,8]],m[Sigma[s,9]]);
            Mix(v,1,6,11,12,m[Sigma[s,10]],m[Sigma[s,11]]);
            Mix(v,2,7,8,13,m[Sigma[s,12]],m[Sigma[s,13]]);
            Mix(v,3,4,9,14,m[Sigma[s,14]],m[Sigma[s,15]]);
        }
        for (int i = 0; i < 8; i++) h[i] ^= v[i] ^ v[i + 8];
    }
    public static string FileBlake2b256(string path)
    {
        var h = (ulong[])Initial.Clone();
        h[0] ^= 0x01010020UL; // unkeyed, fanout/depth 1, 32-byte digest
        var block = new byte[128];
        ulong total = 0;
        using (var stream = File.OpenRead(path)) {
            while (true) {
                Array.Clear(block, 0, block.Length);
                int used = 0;
                while (used < block.Length) {
                    int read = stream.Read(block, used, block.Length - used);
                    if (read == 0) break;
                    used += read;
                }
                total += (ulong)used;
                bool final = stream.Position == stream.Length;
                Compress(h, block, total, final);
                if (final) break;
            }
        }
        var text = new StringBuilder(64);
        for (int i = 0; i < 32; i++)
            text.Append(((byte)(h[i / 8] >> (8 * (i % 8)))).ToString("x2"));
        return text.ToString();
    }
}
