package expo.modules.saxnative

import java.io.File
import java.net.URI

internal fun isPrivateFileUri(filesDir: File, uri: String): Boolean = runCatching {
  val root = filesDir.canonicalFile
  val file = File(URI(uri)).canonicalFile
  (file == root || file.path.startsWith(root.path + File.separator)) && file.exists()
}.getOrDefault(false)
