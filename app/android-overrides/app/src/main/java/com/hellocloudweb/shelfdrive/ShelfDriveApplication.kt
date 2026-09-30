package com.hellocloudweb.shelfdrive

import android.app.Application
import androidx.annotation.Keep
import androidx.work.Configuration

/** Keeps WorkManager's JobScheduler IDs away from Shelf Drive's UIDT job ID (2028). */
@Keep
class ShelfDriveApplication : Application(), Configuration.Provider {
  override val workManagerConfiguration: Configuration
    get() = Configuration.Builder()
      .setJobSchedulerJobIdRange(10_000, 10_999)
      .build()
}
