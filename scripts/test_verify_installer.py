"""Exercise Windows cleanup races without requiring a Windows installer."""
import unittest
from unittest.mock import Mock, patch

from verify_installer import cleanup_installer_directory, installer_directory


def windows_error(code):
    error = OSError('Installer file is still in use')
    error.winerror = code
    return error


class InstallerCleanupTests(unittest.TestCase):
    def test_transient_windows_locks_are_retried(self):
        directory = Mock()
        directory.cleanup.side_effect = [windows_error(5), windows_error(32), windows_error(145), None]
        with patch('verify_installer.time.sleep') as sleep:
            cleanup_installer_directory(directory)
        self.assertEqual(directory.cleanup.call_count, 4)
        self.assertEqual(sleep.call_count, 3)

    def test_persistent_lock_still_fails_at_deadline(self):
        directory = Mock()
        error = windows_error(5)
        directory.cleanup.side_effect = error
        with patch('verify_installer.time.monotonic', side_effect=[0, 0, 30]), patch('verify_installer.time.sleep'):
            with self.assertRaises(OSError) as raised:
                cleanup_installer_directory(directory)
        self.assertIs(raised.exception, error)
        self.assertEqual(directory.cleanup.call_count, 2)

    def test_unrelated_errors_fail_immediately(self):
        for error in [OSError('Disk error'), PermissionError('POSIX permissions'), windows_error(3)]:
            directory = Mock()
            directory.cleanup.side_effect = error
            with patch('verify_installer.time.sleep') as sleep:
                with self.assertRaises(OSError) as raised:
                    cleanup_installer_directory(directory)
            self.assertIs(raised.exception, error)
            sleep.assert_not_called()

    def test_cleanup_runs_after_verification_failure_without_hiding_it(self):
        directory = Mock(name='directory')
        directory.name = 'temporary-installer-directory'
        directory.cleanup.side_effect = [windows_error(5), None]
        with patch('verify_installer.tempfile.TemporaryDirectory', return_value=directory), patch('verify_installer.time.sleep'):
            with self.assertRaisesRegex(ValueError, 'Invalid installer'):
                with installer_directory():
                    raise ValueError('Invalid installer')
        self.assertEqual(directory.cleanup.call_count, 2)


if __name__ == '__main__':
    unittest.main()
