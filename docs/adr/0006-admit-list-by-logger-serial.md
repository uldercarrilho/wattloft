# Only Admitted Loggers may write Samples

A public collector will see strangers on the ingest port. Wattloft admits by logger serial, not by peer IP. Unknown serials are closed with no ACK and no write — a bad ACK can lock a real stick, and IP allow-lists fail when the house WAN moves.

The admit list is this Plant’s serials in config shipped by the git deploy pipeline, not a hardcoded pair forever, not a live edit on the VM, and not a Plant view admin page. The Operator adds a serial there before that Logger is pointed at Wattloft. Pairing-on-connect is rejected: an unknown serial is never ACKed.