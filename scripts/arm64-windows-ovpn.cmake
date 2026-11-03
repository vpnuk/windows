# Same native target as upstream, with static CRT to avoid an undeclared
# Visual C++ runtime dependency in VPNUK's portable bin/ patch package.
set(VCPKG_TARGET_ARCHITECTURE arm64)
set(VCPKG_CRT_LINKAGE static)
set(VCPKG_LIBRARY_LINKAGE dynamic)
set(STATIC_PORTS lz4 lzo)
if(PORT IN_LIST STATIC_PORTS)
    set(VCPKG_LIBRARY_LINKAGE static)
endif()
