SHELL := /bin/bash

.PHONY: update check clean

update:
	./scripts/update-comview.sh $(TAG)

check:
	node ./scripts/postinstall.mjs

test-install-local:
	pi install $(PWD)

clean:
	rm -f bin/comview-* bin/checksums.txt bin/metadata.json COMVIEW_VERSION
