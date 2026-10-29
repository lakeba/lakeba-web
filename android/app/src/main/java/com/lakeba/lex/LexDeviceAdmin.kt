package com.lakeba.lex

import android.app.admin.DeviceAdminReceiver

/** Lets Lex be a dedicated tablet's device owner, so it can lock the tablet to Lex (kiosk mode). See README. */
class LexDeviceAdmin : DeviceAdminReceiver()
