#!/bin/bash
BASE_ID="appVzPU0icwL8H6aP"

jq -c '.[]' /tmp/planned_updates.json | while read -r row; do
  recordId=$(echo "$row" | jq -r '.recordId')
  newStatus=$(echo "$row" | jq -r '.shouldBe')
  bookingId=$(echo "$row" | jq -r '.bookingId')

  echo "Updating $bookingId -> $newStatus"

  curl -s -X PATCH "https://api.airtable.com/v0/${BASE_ID}/Active%20Bookings/${recordId}" \
    -H "Authorization: Bearer $AIRTABLE_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"fields\": {\"Payment Status\": \"${newStatus}\"}}" \
    | jq -c '{id, status: .fields["Payment Status"]}'

  sleep 0.25
done

echo "Done."
