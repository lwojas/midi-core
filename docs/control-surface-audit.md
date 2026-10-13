# Control Surface Architecture Conclusion

`ControlMapping` and `bindControlMapping()` remain the single-control mapping primitive. The Control Surface layer composes mappings generated from device profiles, manages their lifecycle, selects active bindings using application context, and resolves application controls without adding device protocol knowledge to Core.
