# Event API 500 Error - Fix Summary

## Problem
The `/api/events` POST endpoint was returning a 500 Internal Server Error when creating new events.

## Root Cause
The `Event` model in `FreeTalkAPI/models/Event.js` has a geospatial index (`2dsphere`) on the `location` field, but the pre-save hook wasn't properly populating the `location.coordinates` array from the `latitude` and `longitude` fields.

When an event was created with `latitude` and `longitude` values, MongoDB would fail to index the document because:
1. The `location.coordinates` field was not being set
2. The geospatial index expected valid GeoJSON coordinates
3. This caused a validation/indexing error resulting in a 500 response

## Solution Applied
Updated the `Event` model's pre-save hook to automatically populate `location.coordinates` from `latitude` and `longitude`:

```javascript
eventSchema.pre('save', function(next) {
  if (!this.eventCode) {
    // 6-char alphanumeric code
    this.eventCode = crypto.randomBytes(4).toString('hex').slice(0, 6).toUpperCase();
  }
  
  // Set location.coordinates from latitude/longitude if provided
  if (this.latitude != null && this.longitude != null) {
    this.location = {
      type: 'Point',
      coordinates: [this.longitude, this.latitude] // GeoJSON format: [longitude, latitude]
    };
  } else {
    // Clear location if coordinates are not provided
    this.location = undefined;
  }
  
  next();
});
```

## Files Modified
- `FreeTalkAPI/models/Event.js` (backup created as `Event.js.backup`)

## Next Steps
1. **Deploy the fix** - Use the deployment script to push changes to production:
   ```powershell
   .\deploy-api-complete.ps1
   ```

2. **Restart the server** - If deploying manually via SSH:
   ```bash
   pm2 restart freetalk-api
   ```

3. **Test the endpoint** - Try creating an event from the Flutter app again

4. **Monitor logs** - Check for any errors:
   ```bash
   pm2 logs freetalk-api
   ```

## Additional Notes
- The fix ensures that GeoJSON coordinates are properly formatted: `[longitude, latitude]`
- If no coordinates are provided, the location field is cleared to avoid indexing issues
- The backup file can be removed after confirming the fix works: `models\Event.js.backup`
