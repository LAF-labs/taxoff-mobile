package expo.modules.saxnative

import java.io.File
import java.nio.file.Files
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class PrivateFileUriTest {
  @get:Rule val tmp = TemporaryFolder()

  @Test fun acceptsExistingInternalFilesAndDirectories() {
    val root = tmp.newFolder("files")
    val file = File(root, "한 글.json").apply { writeText("{}") }
    assertTrue(isPrivateFileUri(root, root.toPath().toUri().toString()))
    assertTrue(isPrivateFileUri(root, file.toPath().toUri().toASCIIString()))
  }

  @Test fun rejectsNonFilesAndMissingPaths() {
    val root = tmp.newFolder("files")
    assertFalse(isPrivateFileUri(root, "content://photos/image"))
    assertFalse(isPrivateFileUri(root, "/not-a-file-uri"))
    assertFalse(isPrivateFileUri(root, File(root, "missing").toURI().toString()))
  }

  @Test fun rejectsExistingFilesOutsideThePrivateDirectory() {
    val root = tmp.newFolder("files")
    val outside = File(tmp.newFolder("files-shared"), "record.json").apply { writeText("{}") }
    val traversal = File(root, "../files-shared/record.json")
    val link = Files.createSymbolicLink(File(root, "link").toPath(), outside.toPath())
    assertFalse(isPrivateFileUri(root, outside.toURI().toString()))
    assertFalse(isPrivateFileUri(root, traversal.toURI().toString()))
    assertFalse(isPrivateFileUri(root, link.toUri().toString()))
  }
}
