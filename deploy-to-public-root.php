<?php

declare(strict_types=1);

$sourceRoot = __DIR__;
$publicRoot = dirname($sourceRoot);

if (basename($sourceRoot) !== 'release-20260813' || basename($publicRoot) !== 'public_html') {
    fwrite(STDERR, "Refusing to deploy outside the expected Hostinger release directory.\n");
    exit(1);
}

$excluded = [
    '.git' => true,
    '.github' => true,
    '.woafmeow-data' => true,
    'composer.json' => true,
    'composer.lock' => true,
    'deploy-to-public-root.php' => true,
];

function copyReleaseTree(string $source, string $destination): void
{
    if (is_dir($source)) {
        if (!is_dir($destination) && !mkdir($destination, 0755, true) && !is_dir($destination)) {
            throw new RuntimeException("Unable to create directory: {$destination}");
        }

        $entries = scandir($source);
        if ($entries === false) {
            throw new RuntimeException("Unable to read directory: {$source}");
        }

        foreach ($entries as $entry) {
            if ($entry === '.' || $entry === '..') {
                continue;
            }
            copyReleaseTree("{$source}/{$entry}", "{$destination}/{$entry}");
        }
        return;
    }

    $temporary = $destination . '.woafmeow-upload-' . getmypid() . '.tmp';
    if (!copy($source, $temporary)) {
        throw new RuntimeException("Unable to stage file: {$destination}");
    }
    if (!rename($temporary, $destination)) {
        @unlink($temporary);
        throw new RuntimeException("Unable to publish file: {$destination}");
    }
}

try {
    $entries = scandir($sourceRoot);
    if ($entries === false) {
        throw new RuntimeException('Unable to read the release directory.');
    }

    foreach ($entries as $entry) {
        if ($entry === '.' || $entry === '..' || isset($excluded[$entry])) {
            continue;
        }
        copyReleaseTree("{$sourceRoot}/{$entry}", "{$publicRoot}/{$entry}");
    }

    fwrite(STDOUT, "WoafMeow release copied to public_html successfully.\n");
} catch (Throwable $error) {
    fwrite(STDERR, $error->getMessage() . "\n");
    exit(1);
}
