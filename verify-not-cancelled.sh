#!/bin/bash
BASE_ID="appVzPU0icwL8H6aP"

# Pull all Cancelled Bookings IDs
cancelled="[]"; offset=""
while true; do
  url="https://api.airtable.com/v0/${BASE_ID}/Cancelled%20Bookings?fields%5B%5D=Booking%20ID"
  [ -n "$offset" ] && url="${url}&offset=${offset}"
  resp=$(curl -s "$url" -H "Authorization: Bearer $AIRTABLE_TOKEN")
  cancelled=$(jq -s '.[0] + .[1].records' <(echo "$cancelled") <(echo "$resp"))
  offset=$(echo "$resp" | jq -r '.offset // empty')
  [ -z "$offset" ] && break
done

jq -r '.[].fields["Booking ID"]' <(echo "$cancelled") | sort > /tmp/cancelled_ids.txt

# Extract the IDs we updated
jq -r '.[].bookingId' /tmp/planned_updates.json | sort > /tmp/updated_ids.txt

echo "Checking for overlap..."
comm -12 /tmp/cancelled_ids.txt /tmp/updated_ids.txt > /tmp/overlap.txt

if [ -s /tmp/overlap.txt ]; then
  echo "⚠️  WARNING — these updated bookings ALSO appear in Cancelled Bookings:"
  cat /tmp/overlap.txt
else
  echo "✅ No overlap — none of the updated records exist in Cancelled Bookings."
fi
