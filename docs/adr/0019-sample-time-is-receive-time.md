# Sample time is collector receive time

MW3_15U `0x4210` frames look like they carry a clock: a family unix/offset word and a trailing Y-M-D-H-M-S. On this Plant the unix slot is always 0, and the civil six-tuple is timezone-naive and can stay frozen for a whole session, so using it would pile many live points onto one instant. After a ~26.5 h Server B gap each stick sent one live snapshot, not queued history. HTTP and Modbus are now/today/lifetime only.

Wattloft therefore timestamps a Sample when it receives it. Do not put unix in the 10-byte ACK to “fix” the stick clock: family cloud does that; the proven MW3_15U reply is ten zeros, and extra ACK bytes can lock the stick.
