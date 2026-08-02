#!/bin/bash
BASE_ID="appVzPU0icwL8H6aP"

active="[]"; offset=""
while true; do
  url="https://api.airtable.com/v0/${BASE_ID}/Active%20Bookings?fields%5B%5D=Booking%20ID&fields%5B%5D=Payment%20Status"
  [ -n "$offset" ] && url="${url}&offset=${offset}"
  resp=$(curl -s "$url" -H "Authorization: Bearer $AIRTABLE_TOKEN")
  active=$(jq -s '.[0] + .[1].records' <(echo "$active") <(echo "$resp"))
  offset=$(echo "$resp" | jq -r '.offset // empty')
  [ -z "$offset" ] && break
done
echo "$active" > /tmp/active_full.json

bookings="[]"; offset=""
while true; do
  url="https://api.airtable.com/v0/${BASE_ID}/Bookings?fields%5B%5D=Booking%20Reference&fields%5B%5D=Payment%20Status"
  [ -n "$offset" ] && url="${url}&offset=${offset}"
  resp=$(curl -s "$url" -H "Authorization: Bearer $AIRTABLE_TOKEN")
  bookings=$(jq -s '.[0] + .[1].records' <(echo "$bookings") <(echo "$resp"))
  offset=$(echo "$resp" | jq -r '.offset // empty')
  [ -z "$offset" ] && break
done
echo "$bookings" > /tmp/bookings_full.json

jq '
  map(select(.fields["Booking Reference"] != null and (.fields["Booking Reference"] | startswith("BK-")))) |
  map({(.fields["Booking Reference"] | ascii_downcase): .fields["Payment Status"]}) |
  add // {}
' /tmp/bookings_full.json > /tmp/live_map.json

jq -s '
  .[0] as $live | .[1] |
  map(select(.fields["Booking ID"] != null and (.fields["Booking ID"] | startswith("BK-")))) |
  map({
    recordId: .id,
    bookingId: .fields["Booking ID"],
    current: (.fields["Payment Status"] // null),
    shouldBe: $live[(.fields["Booking ID"] | ascii_downcase)]
  }) |
  map(select(.current != .shouldBe and .shouldBe != null))
' /tmp/live_map.json /tmp/active_full.json | tee /tmp/planned_updates.json
