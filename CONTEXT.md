# Wattloft

Wattloft observes production of one household solar Plant. It exists so that Plant can be watched without using the vendor cloud as the store.

## Language

**Plant**:
This household’s solar installation as a whole: the Microinverters on this roof, treated as one producing unit. A Plant produces; it does not consume, import, or store energy.
_Avoid_: site, system, home, account, installation

**Microinverter**:
The device that converts PV to AC. This Plant’s producers are microinverters. The manufacturer serial is an attribute, not identity in Wattloft.
_Avoid_: inverter (when you mean the Wi-Fi stick), stick, logger

**Logger**:
The Wi-Fi stick attached to one Microinverter. It is the thing that reports. Wattloft identifies a Logger by logger serial. MAC may locate it on the LAN. IP is never identity.
_Avoid_: inverter, dongle, stick (as the key), IP, inverter serial (as the key)

**Admitted Logger**:
A Logger whose serial is on this Plant’s admit list. Only Admitted Loggers may create Samples. An unknown serial is refused: connection closed, no ACK, no write. The Operator changes the list by shipping config through the git deploy pipeline before that Logger is pointed at Wattloft. The list is not edited on a live VM, is not a Plant view surface, and a Logger cannot admit itself by connecting.
_Avoid_: registered device, paired stick, IP allow-list, any Logger that parses, registration phase

**Sample**:
One observation of a Logger at the moment Wattloft received it: AC Power, Today energy, Lifetime energy, and whether the parse succeeded. Receive time is the timestamp. In-frame clocks on this Plant’s Loggers are not Sample time (the V5 unix/offset slot is zero; the civil Y-M-D-H-M-S is naive and can stay frozen across uploads) and are ignored. A failed parse is not a zero. Night-time zero Power with a successful parse is valid.
_Avoid_: reading, measurement, frame (a frame may fail to become a Sample), point, stick time, logger RTC

**Power**:
Instantaneous AC watts. Plant Power at a time is the sum of Loggers that actually have a successful Power then. A missing Logger is omitted, not coerced to 0 W.
_Avoid_: production (when you mean energy), output, curve watts

**Current Power**:
The most recent successful Plant Power in History. It is always shown with that Sample’s receive time. Age does not invalidate it. If History has no successful Power, Current Power is absent (a dash), not zero.
_Avoid_: live power, real-time, now (without an as-of time), the curve hair

**Curve watts**:
The Plant view hair’s watts at a Local time: linear interpolation per Logger between consecutive Samples at most 15 minutes apart; a Logger outside that window is omitted, never held and never 0 W. Plant curve watts are the sum of Loggers that have curve watts then. Not a Sample, not Power, not Current Power. A failed parse does not close a gap. In a hole the hair stays and the numbers dash.
_Avoid_: Power, Current Power, live power, interpolated Power

**Operator**:
The single person allowed to see the Plant in Wattloft. v1 proves it with a password (or passkey) Wattloft stores. Not a household account list, not an external identity provider, and not “anyone with the link.”
_Avoid_: user, admin, customer, viewer, SSO, Cognito

**Plant view**:
What the Operator sees over HTTPS on a hostname: Today energy, Current Power, Lifetime energy, Last sample as the relative age of Current Power’s Sample, Local-day Today energy bars, and that Local day’s Power curve (each Logger and the Plant). Login, empty History, and Plant view share one Azulejo look. Nothing else is a v1 surface.
_Avoid_: report, dashboard, equipment data, live view, efficiency, month rollup, HTTP (plaintext)

**Today energy**:
The Logger’s own “energy today” counter, not watts integrated over time. For a Local day, Plant Today energy is the last successful Today energy per Logger that day, then summed. A Logger with no successful Sample that day contributes nothing, not zero. Staleness of a Logger must stay visible.
_Avoid_: daily production (when you mean an integral of Power), yield from the watt curve

**Lifetime energy**:
The Logger’s cumulative energy counter. Plant Lifetime energy is the last successful Lifetime energy per Logger, then summed.
_Avoid_: total (unqualified), all-time production

**History**:
The Samples Wattloft has stored. History begins at Wattloft’s first successful Sample. It is not tied to a particular collector host: replacing the VM does not start History over. There is no backfill from the vendor, from Titan, or from the Logger: these Loggers send a live snapshot on Server B, not a queued timeseries.
_Avoid_: complete production record, Titan database, prior monitoring, disk on the VM, logger buffer

**Local day**:
A calendar date in `America/Sao_Paulo`. “Today” and chart axes use Local days.
_Avoid_: UTC day, logger-clock day, calendar (unqualified)

**Server A**:
The Logger’s vendor-cloud destination (Intelbras / Solarman). It is not Wattloft. Wattloft must not occupy this slot.
_Avoid_: cloud, primary server (unqualified)

**Server B**:
The Logger’s optional second destination, and Wattloft’s only ingest path: a Logger pushes, Wattloft does not poll. Loggers dial the same hostname the Operator uses for Plant view, on the ingest TCP port, not on 443. HTTP `status.html` collect is not a Wattloft path. Clearing Server B to unbrick a Logger means History grows a gap.
_Avoid_: backup server, remote server (the public UI label this firmware ignores), HTTP collect
