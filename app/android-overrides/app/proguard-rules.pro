-keepattributes *Annotation*

# Rust resolves these classes and their static Kotlin bridges by literal JNI names.
# Keep the complete boundary so release minification cannot remove a newly added
# JNI entry point that has no Java/Kotlin caller.
-keep class com.hellocloudweb.shelfdrive.MainActivity { *; }
-keep class com.hellocloudweb.shelfdrive.UploadForegroundService { *; }
-keep class com.hellocloudweb.shelfdrive.MediaPlayerActivity { *; }
-keep class com.hellocloudweb.shelfdrive.PlaybackService { *; }
-keep class com.hellocloudweb.shelfdrive.TransferJobService { *; }
-keep class com.hellocloudweb.shelfdrive.TransferRecoveryWorker { *; }
-keep class com.hellocloudweb.shelfdrive.ShelfDriveApplication { *; }
