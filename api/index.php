<?php
declare(strict_types=1);

// Hostinger shared hosting does not always forward dashboard environment
// variables to PHP-FPM. Load an optional protected api/.env file first, while
// preserving any variables already supplied by the server.
$envFile = __DIR__ . '/.env';
if (is_readable($envFile)) {
    foreach (file($envFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) ?: [] as $line) {
        $line = trim($line);
        if ($line === '' || str_starts_with($line, '#') || !str_contains($line, '=')) continue;
        [$name, $value] = array_map('trim', explode('=', $line, 2));
        if (!preg_match('/^[A-Z][A-Z0-9_]*$/', $name) || getenv($name) !== false) continue;
        if (strlen($value) >= 2 && (($value[0] === '"' && str_ends_with($value, '"')) || ($value[0] === "'" && str_ends_with($value, "'")))) {
            $value = substr($value, 1, -1);
        }
        putenv($name . '=' . $value);
        $_ENV[$name] = $value;
    }
}

$requestUri = $_SERVER['REQUEST_URI'] ?? '/api';
$path = parse_url($requestUri, PHP_URL_PATH) ?: '/api';
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
$allowedOrigins = ['https://labian1.github.io', 'https://www.woafmeow.com', 'https://woafmeow.com'];
if (in_array($origin, $allowedOrigins, true)) {
    header('Access-Control-Allow-Origin: ' . $origin);
    header('Vary: Origin');
    header('Access-Control-Allow-Methods: POST, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type');
}
if ($method === 'OPTIONS') {
    http_response_code(204);
    exit;
}

function respond(int $status, array $payload): never {
    http_response_code($status);
    header('content-type: application/json; charset=utf-8');
    header('cache-control: no-store');
    echo json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    exit;
}

function inputBody(): array {
    $decoded = json_decode(file_get_contents('php://input') ?: '{}', true);
    return is_array($decoded) ? $decoded : [];
}

function clean(mixed $value, int $max = 500): string {
    $value = preg_replace('/\s+/u', ' ', trim(strip_tags((string)$value))) ?? '';
    return function_exists('mb_substr') ? mb_substr($value, 0, $max) : substr($value, 0, $max);
}

function dataDir(): string {
    $configured = trim((string)(getenv('WOAFMEOW_DATA_DIR') ?: ''));
    $dir = $configured !== '' ? $configured : dirname(__DIR__) . '/.woafmeow-data';
    if (!is_dir($dir) && !mkdir($dir, 0750, true) && !is_dir($dir)) {
        respond(503, ['error' => 'WoafMeow storage is temporarily unavailable.']);
    }
    return $dir;
}

function readRows(string $name): array {
    $file = dataDir() . '/' . $name . '.json';
    if (!is_file($file)) return [];
    $rows = json_decode(file_get_contents($file) ?: '[]', true);
    return is_array($rows) ? $rows : [];
}

function saveRows(string $name, array $rows): void {
    $file = dataDir() . '/' . $name . '.json';
    $tmp = $file . '.' . bin2hex(random_bytes(4)) . '.tmp';
    $encoded = json_encode(array_values($rows), JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    if (file_put_contents($tmp, $encoded, LOCK_EX) === false || !rename($tmp, $file)) {
        @unlink($tmp);
        respond(503, ['error' => 'We could not save that right now. Please try again.']);
    }
}

function id(string $prefix): string {
    return $prefix . '_' . bin2hex(random_bytes(10));
}

function memberCredentials(array $body = []): array {
    return [
        clean($body['memberId'] ?? ($_SERVER['HTTP_X_CARE_CIRCLE_MEMBER'] ?? ''), 100),
        clean($body['memberToken'] ?? ($_SERVER['HTTP_X_CARE_CIRCLE_TOKEN'] ?? ''), 180),
    ];
}

function authenticatedMember(array $body = []): ?array {
    [$memberId, $token] = memberCredentials($body);
    if (!$memberId || !$token) return null;
    foreach (readRows('members') as $member) {
        if (($member['id'] ?? '') === $memberId && hash_equals((string)($member['token'] ?? ''), $token)) return $member;
    }
    return null;
}

function ownedPet(string $petId, string $memberId): ?array {
    foreach (readRows('pets') as $pet) {
        if (($pet['id'] ?? '') === $petId && ($pet['memberId'] ?? '') === $memberId) return $pet;
    }
    return null;
}

function requireMember(array $body = []): array {
    $member = authenticatedMember($body);
    if (!$member) respond(401, ['error' => 'Please enroll your pet or sign in again.']);
    return $member;
}

function replaceRow(string $name, string $idValue, array $updated): void {
    $rows = readRows($name);
    $found = false;
    foreach ($rows as $index => $row) {
        if (($row['id'] ?? '') === $idValue) {
            $rows[$index] = $updated;
            $found = true;
            break;
        }
    }
    if (!$found) $rows[] = $updated;
    saveRows($name, $rows);
}

function syncBrevo(array $record, string $source = 'woafmeow.com'): void {
    $key = getenv('BREVO_API_KEY') ?: '';
    $listId = (int)(getenv('BREVO_WEBSITE_LIST_ID') ?: 0);
    $email = strtolower(clean($record['email'] ?? '', 254));
    if ($key === '' || $listId < 1 || !filter_var($email, FILTER_VALIDATE_EMAIL) || !function_exists('curl_init')) return;
    $payload = [
        'email' => $email,
        'attributes' => [
            'FIRSTNAME' => clean($record['ownerName'] ?? $record['name'] ?? $record['firstName'] ?? $record['contactName'] ?? '', 80),
            'PET_NAME' => clean($record['dogName'] ?? $record['petName'] ?? '', 80),
            'PET_TYPE' => clean($record['species'] ?? '', 20),
            'SOURCE' => $source,
        ],
        'listIds' => [$listId],
        'updateEnabled' => true,
    ];
    $ch = curl_init('https://api.brevo.com/v3/contacts');
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 10,
        CURLOPT_HTTPHEADER => ['api-key: ' . $key, 'content-type: application/json'],
        CURLOPT_POSTFIELDS => json_encode($payload),
    ]);
    curl_exec($ch);
    curl_close($ch);
}

function notifyOwner(string $subject, array $record): array {
    $key = getenv('BREVO_API_KEY') ?: '';
    $sender = strtolower(clean(getenv('BREVO_SENDER_EMAIL') ?: '', 254));
    $configuredRecipients = preg_split('/[;,]/', (string)(getenv('FORM_NOTIFICATION_EMAIL') ?: 'robert.luo@woafmeow.com')) ?: [];
    $recipients = [];
    foreach ($configuredRecipients as $recipient) {
        $recipient = strtolower(clean($recipient, 254));
        if (filter_var($recipient, FILTER_VALIDATE_EMAIL)) $recipients[$recipient] = ['email' => $recipient];
    }
    if ($key === '') return ['status' => 'skipped', 'detail' => 'BREVO_API_KEY is not configured.'];
    if (!filter_var($sender, FILTER_VALIDATE_EMAIL)) return ['status' => 'skipped', 'detail' => 'BREVO_SENDER_EMAIL is not configured.'];
    if (!$recipients) return ['status' => 'skipped', 'detail' => 'FORM_NOTIFICATION_EMAIL has no valid recipient.'];
    if (!function_exists('curl_init')) return ['status' => 'failed', 'detail' => 'The PHP cURL extension is unavailable.'];

    $allowed = [
        'type', 'email', 'ownerName', 'name', 'firstName', 'contactName', 'organization', 'requestType',
        'serviceType', 'coverage', 'sessionTitle', 'petName', 'dogName', 'species', 'action', 'topic',
        'collection', 'timing', 'city', 'region', 'country', 'status', 'result', 'postId',
        'conversationId', 'matchId', 'hasMedia', 'createdAt',
    ];
    $rows = '';
    foreach ($allowed as $field) {
        $value = $record[$field] ?? '';
        if (!is_scalar($value) || trim((string)$value) === '') continue;
        $label = htmlspecialchars($field, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
        $display = htmlspecialchars(clean($value, 500), ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
        $rows .= '<tr><th align="left" style="padding:6px 12px 6px 0">' . $label . '</th><td style="padding:6px 0">' . $display . '</td></tr>';
    }
    $payload = [
        'sender' => ['email' => $sender, 'name' => 'WoafMeow Forms'],
        'to' => array_values($recipients),
        'subject' => clean($subject, 180),
        'htmlContent' => '<h2>New WoafMeow submission</h2>' . ($rows !== '' ? '<table>' . $rows . '</table>' : '<p>Open the private operations dashboard for details.</p>'),
    ];
    $ch = curl_init('https://api.brevo.com/v3/smtp/email');
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 15,
        CURLOPT_HTTPHEADER => ['api-key: ' . $key, 'content-type: application/json'],
        CURLOPT_POSTFIELDS => json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE),
    ]);
    $response = curl_exec($ch);
    $status = curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    $error = curl_error($ch);
    curl_close($ch);
    if ($response === false || $status < 200 || $status >= 300) {
        return ['status' => 'failed', 'detail' => $error !== '' ? clean($error, 300) : 'Brevo SMTP returned HTTP ' . $status . '.'];
    }
    return ['status' => 'sent', 'detail' => 'Brevo accepted the owner notification.'];
}

function sendGuideEmail(string $email): array {
    $key = getenv('BREVO_API_KEY') ?: '';
    $sender = strtolower(clean(getenv('BREVO_SENDER_EMAIL') ?: '', 254));
    $email = strtolower(clean($email, 254));
    if ($key === '') return ['status' => 'skipped', 'detail' => 'BREVO_API_KEY is not configured.'];
    if (!filter_var($sender, FILTER_VALIDATE_EMAIL)) return ['status' => 'skipped', 'detail' => 'BREVO_SENDER_EMAIL is not configured.'];
    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) return ['status' => 'failed', 'detail' => 'The recipient email is invalid.'];
    if (!function_exists('curl_init')) return ['status' => 'failed', 'detail' => 'The PHP cURL extension is unavailable.'];
    $guideUrl = 'https://labian1.github.io/guide/';
    $payload = [
        'sender' => ['email' => $sender, 'name' => 'WoafMeow'],
        'to' => [['email' => $email]],
        'subject' => 'Your complete Senior Dog Care Guide',
        'htmlContent' => '<div style="font-family:Arial,sans-serif;max-width:620px;margin:auto;color:#2c2521"><h1 style="color:#17382d">Your Senior Dog Care Guide</h1><p>Use this guide to turn a change you noticed into a clearer next step.</p><ul><li>Movement and stiffness</li><li>Sleep and nighttime changes</li><li>Eating, drinking and bathroom changes</li><li>Daily life, comfort and call-sooner signs</li></ul><p><a href="' . $guideUrl . '" style="display:inline-block;padding:14px 20px;background:#a44b2a;color:#fff;text-decoration:none;border-radius:6px">Open the complete guide</a></p><p>WoafMeow provides educational guidance. Sudden or severe signs need veterinary care.</p></div>',
    ];
    $ch = curl_init('https://api.brevo.com/v3/smtp/email');
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 15,
        CURLOPT_HTTPHEADER => ['api-key: ' . $key, 'content-type: application/json'],
        CURLOPT_POSTFIELDS => json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE),
    ]);
    $response = curl_exec($ch);
    $status = curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    $error = curl_error($ch);
    curl_close($ch);
    if ($response === false || $status < 200 || $status >= 300) {
        return ['status' => 'failed', 'detail' => $error !== '' ? clean($error, 300) : 'Brevo SMTP returned HTTP ' . $status . '.'];
    }
    return ['status' => 'sent', 'detail' => 'Brevo accepted the Senior Dog Care Guide email.'];
}

function saveSubmission(string $type, array $record, bool $sendOwnerNotification = true): void {
    $record['id'] = $record['id'] ?? id('submission');
    $record['type'] = $type;
    $record['createdAt'] = $record['createdAt'] ?? gmdate('c');
    $rows = readRows('submissions');
    $rows[] = $record;
    saveRows('submissions', $rows);
    syncBrevo($record, 'woafmeow.com/' . $type);
    $delivery = $sendOwnerNotification
        ? notifyOwner('New WoafMeow ' . str_replace('-', ' ', $type), $record)
        : ['status' => 'suppressed', 'detail' => 'Owner notification already sent for this workflow.'];
    $log = readRows('notification-log');
    $log[] = [
        'id' => id('notification'),
        'submissionId' => $record['id'],
        'type' => $type,
        'email' => strtolower(clean($record['email'] ?? '', 254)),
        'status' => $delivery['status'],
        'detail' => $delivery['detail'],
        'createdAt' => gmdate('c'),
    ];
    if (count($log) > 5000) $log = array_slice($log, -5000);
    saveRows('notification-log', $log);
}

function saveMemberAction(string $type, array $owner, array $pet = [], array $properties = [], bool $sendOwnerNotification = true): void {
    $record = [
        'email' => strtolower(clean($owner['email'] ?? '', 254)),
        'ownerName' => clean($owner['ownerName'] ?? $owner['firstName'] ?? '', 80),
        'petName' => clean($pet['dogName'] ?? $pet['petName'] ?? '', 80),
        'species' => clean($pet['species'] ?? '', 20),
    ];
    foreach ($properties as $field => $value) {
        if (is_scalar($value)) $record[clean($field, 60)] = clean($value, 500);
    }
    saveSubmission($type, $record, $sendOwnerNotification);
}

function topicFrom(string $question): string {
    $rules = [
        'urgent' => '/collapse|cannot breathe|can.t breathe|trouble breathing|seizure|poison|toxin|cannot urinate|blue gums|unresponsive/i',
        'appetite' => '/eat|food|appetite|weight|drink|water|vomit|nausea|chew|swallow/i',
        'litter' => '/litter|urine|pee|poop|box|strain/i',
        'sleep' => '/sleep|night|pace|pacing|restless|settle|wake|whin/i',
        'cognition' => '/confus|stare|lost|corner|anxious|cling|behavior|behaviour/i',
        'quality' => '/good day|quality of life|goodbye|euth|hospice|dying|end of life|loss/i',
        'vet' => '/vet|appointment|visit|diagnos|test|medication/i',
        'products' => '/bed|toy|bowl|ramp|food|supplement|product|recommend/i',
        'mobility' => '/stand|rise|stiff|limp|walk|stairs|jump|slip|joint|mobility|pain/i',
    ];
    foreach ($rules as $topic => $pattern) if (preg_match($pattern, $question)) return $topic;
    return 'general';
}

function topicName(string $topic): string {
    return [
        'mobility' => 'Mobility & movement', 'sleep' => 'Sleep & settling', 'appetite' => 'Appetite & weight',
        'litter' => 'Litter-box changes', 'cognition' => 'Behavior & cognition', 'quality' => 'Good days & comfort',
        'vet' => 'Vet visits', 'products' => 'Comfort at home', 'urgent' => 'Urgent care', 'general' => 'Daily routine',
    ][$topic] ?? 'Daily routine';
}

function intakeQuestions(string $topic, array $pet): array {
    $base = [
        ['name' => 'when', 'label' => 'When did you first notice this change?', 'type' => 'select', 'options' => [['today', 'Today'], ['week', 'Within the last week'], ['month', 'Within the last month'], ['longer', 'More than a month ago']]],
        ['name' => 'frequency', 'label' => 'How often is it happening now?', 'type' => 'select', 'options' => [['once', 'It happened once'], ['occasional', 'A few times a week'], ['daily', 'Every day'], ['repeated', 'Several times a day']]],
    ];
    $specific = [
        'mobility' => ['name' => 'changedMoment', 'label' => 'Which movement shows it most clearly: rising, walking, stairs, jumping, turning, or toileting?', 'type' => 'text'],
        'sleep' => ['name' => 'changedMoment', 'label' => 'What happens during the wake-up: pacing, panting, vocalizing, staring, asking to go out, or changing rooms?', 'type' => 'text'],
        'appetite' => ['name' => 'changedMoment', 'label' => 'What changed around food: interest, amount, chewing, swallowing, nausea, water, stool, urine, or weight?', 'type' => 'text'],
        'litter' => ['name' => 'changedMoment', 'label' => 'What happens at the box: repeated visits, effort, vocalizing, accidents, small output, or avoiding the entrance?', 'type' => 'text'],
        'cognition' => ['name' => 'changedMoment', 'label' => 'Describe one exact episode from beginning to end. How did it resolve?', 'type' => 'text'],
        'quality' => ['name' => 'changedMoment', 'label' => 'Name one reliable good-day moment and one hard moment affecting comfort.', 'type' => 'text'],
        'vet' => ['name' => 'changedMoment', 'label' => 'What is the one change your veterinary team must understand before the visit ends?', 'type' => 'text'],
        'products' => ['name' => 'changedMoment', 'label' => 'Which exact care moment should a product make safer or easier?', 'type' => 'text'],
        'general' => ['name' => 'changedMoment', 'label' => 'Describe the clearest moment when this felt different from your pet\'s normal.', 'type' => 'text'],
        'urgent' => ['name' => 'changedMoment', 'label' => 'What is happening right now, and is your pet breathing, responsive, and able to stand or urinate?', 'type' => 'text'],
    ];
    $base[] = $specific[$topic] ?? $specific['general'];
    $base[] = ['name' => 'impact', 'label' => 'How much is daily life affected?', 'type' => 'select', 'options' => [['mild', 'The routine still happens'], ['moderate', 'Some routines need help'], ['high', 'Basic routines are disrupted']]];
    $conditions = clean($pet['healthConditions'] ?? '', 300);
    if ($conditions !== '') $base[] = ['name' => 'historyLink', 'label' => 'Does this seem connected to ' . $conditions . ', or does it feel different?', 'type' => 'text', 'optional' => true];
    return array_slice($base, 0, 5);
}

function patternFrom(array $context): array {
    $scores = [
        'frequency' => ['once' => 20, 'occasional' => 45, 'daily' => 72, 'repeated' => 94],
        'impact' => ['mild' => 30, 'moderate' => 65, 'high' => 94],
    ];
    return [
        ['label' => 'Frequency', 'value' => $scores['frequency'][$context['frequency'] ?? 'once'] ?? 20, 'text' => clean($context['frequency'] ?? 'not recorded', 50)],
        ['label' => 'Daily impact', 'value' => $scores['impact'][$context['impact'] ?? 'mild'] ?? 30, 'text' => clean($context['impact'] ?? 'not recorded', 50)],
        ['label' => 'Time observed', 'value' => ['today' => 25, 'week' => 45, 'month' => 70, 'longer' => 90][$context['when'] ?? 'today'] ?? 25, 'text' => clean($context['when'] ?? 'not recorded', 50)],
    ];
}

function lessonKnowledge(string $topic): array {
    $commonSources = [
        ['Merck Veterinary Manual: Dog Owners', 'https://www.merckvetmanual.com/dog-owners'],
        ['Merck Veterinary Manual: Cat Owners', 'https://www.merckvetmanual.com/cat-owners'],
        ['2023 AAHA Senior Care Guidelines for Dogs and Cats', 'https://www.aaha.org/resources/2023-aaha-senior-care-guidelines-for-dogs-and-cats/'],
    ];
    $knowledge = [
        'mobility' => [
            'title' => 'Read the first movement after rest',
            'summary' => 'The first rise, first turn, and first few steps can show effort that disappears once a pet warms up.',
            'notice' => ['Length of the pause before standing', 'Short, uneven, wide, or slipping first steps', 'Routes, stairs, jumps, or litter boxes being avoided', 'Whether movement improves or worsens after several minutes'],
            'today' => ['Film one ordinary rise without asking for a repeat', 'Add traction to the route already used', 'Pause jumping and difficult stairs until the change is assessed'],
            'vet' => 'Seek prompt veterinary care for sudden inability to stand, dragging a limb, collapse, crying out, or rapidly worsening weakness.',
            'questions' => ['Could pain be present without crying?', 'What movement is safe while we investigate?', 'What should improve if the care plan is working?'],
            'image' => '/media/real/photo-36.jpg',
        ],
        'sleep' => [
            'title' => 'Map the night before changing the routine',
            'summary' => 'Night waking can overlap with pain, bathroom urgency, medication timing, temperature, anxiety, sensory loss, or cognitive change.',
            'notice' => ['First wake-up time and what happened before it', 'Pacing, panting, vocalizing, staring, or asking to go out', 'The room or surface chosen instead', 'What helps and how long settling takes'],
            'today' => ['Keep a low-light path to water and the bathroom route', 'Write a simple timeline for one night', 'Compare wake-ups with meals and medication times'],
            'vet' => 'Seek prompt care for labored breathing, repeated distress, collapse, severe pain, or sudden disorientation.',
            'questions' => ['Could pain or bathroom urgency be waking my pet?', 'Could medication timing contribute?', 'Which nighttime signs require urgent care?'],
            'image' => '/media/real/photo-22.jpg',
        ],
        'appetite' => [
            'title' => 'Track the pattern around the bowl',
            'summary' => 'Amount eaten, interest, chewing, swallowing, nausea, water, bathroom habits, and weight create a more useful picture than “ate less.”',
            'notice' => ['Actual amount eaten versus normal', 'Treat interest versus regular food', 'Dropping food, one-sided chewing, lip licking, or hard swallowing', 'Water, urine, stool, vomiting, and weekly weight'],
            'today' => ['Record actual amounts for 24 hours', 'Keep familiar food unless a veterinarian advises a change', 'Gather every medication and supplement name'],
            'vet' => 'A senior pet who stops eating, repeatedly vomits, becomes weak, seems painful, or drinks or urinates much more needs timely veterinary advice.',
            'questions' => ['Could dental pain, nausea, medication, or organ disease be involved?', 'What food and water amount should I track?', 'When does this become same-day care?'],
            'image' => '/media/real/photo-32.jpg',
        ],
        'litter' => [
            'title' => 'Treat litter-box changes as health information',
            'summary' => 'Frequency, effort, posture, vocalizing, accidents, and clump size may reveal medical or mobility problems before other signs are obvious.',
            'notice' => ['How often the box is entered and whether output appears', 'Straining, vocalizing, licking, or repeated small visits', 'Whether the edge, stairs, or location now creates effort', 'Clump size, stool, thirst, appetite, and hiding'],
            'today' => ['Add a low-entry box on the most-used floor', 'Keep the original box while testing a second setup', 'Note output and effort without delaying care'],
            'vet' => 'A cat straining and unable to pass urine needs emergency veterinary care, especially a male cat.',
            'questions' => ['Could urinary disease or pain explain this?', 'Would a urine test and exam be appropriate?', 'Which exact signs mean emergency care?'],
            'image' => '/media/real/photo-58.jpg',
        ],
        'cognition' => [
            'title' => 'Describe the episode, not only the behavior',
            'summary' => 'Confusion, staring, altered sleep, accidents, clinginess, or anxiety can overlap with pain, sensory loss, medication effects, and illness.',
            'notice' => ['Time of day and exact sequence', 'Vision, hearing, pain, appetite, and bathroom changes', 'Duration and recovery', 'Familiar cues or routes that no longer work'],
            'today' => ['Keep furniture and nighttime paths predictable', 'Use gentle light and familiar cues', 'Save a short video of an ordinary episode'],
            'vet' => 'Sudden severe disorientation, collapse, circling, seizure, head tilt, or inability to walk needs prompt care.',
            'questions' => ['What medical causes should be ruled out?', 'Could pain or sensory loss contribute?', 'How will we measure improvement?'],
            'image' => '/media/real/photo-39.jpg',
        ],
        'quality' => [
            'title' => 'Look at comfort, function, and joy together',
            'summary' => 'Quality of life is not one score. Comfort, appetite, hydration, breathing, hygiene, sleep, mobility, anxiety, connection, and recovery all matter.',
            'notice' => ['One reliable sign of comfort', 'One activity that still brings interest', 'How often distress appears and whether relief works', 'Whether basic needs can be met without fear or exhaustion'],
            'today' => ['Choose one personal good-day marker', 'Record hard moments with duration and recovery', 'Ask a veterinarian to define comfort goals and crisis signs'],
            'vet' => 'You do not need to wait for a crisis to request a quality-of-life or hospice conversation.',
            'questions' => ['What comfort goals are realistic now?', 'Which symptoms can still be relieved?', 'What would make waiting unkind?'],
            'image' => '/media/real/photo-10.jpg',
        ],
        'urgent' => [
            'title' => 'Pause the lesson and contact urgent care',
            'summary' => 'Some changes should not wait for online guidance. Breathing trouble, collapse, seizure, suspected toxin exposure, inability to urinate, blue gums, or unresponsiveness need immediate help.',
            'notice' => ['Breathing effort and gum color', 'Responsiveness and ability to stand', 'Urination and suspected toxin exposure', 'Exact start time and rapid change'],
            'today' => ['Call the nearest emergency veterinary hospital', 'Bring medication and toxin packaging', 'Do not give human medication unless instructed'],
            'vet' => 'This pattern may be an emergency. Contact an emergency veterinary service now.',
            'questions' => ['Where is the nearest open emergency hospital?', 'What should I do during transport?', 'What information should I bring?'],
            'image' => '/media/real/photo-54.jpg',
        ],
    ];
    $fallback = [
        'title' => 'Turn the worry into an observable pattern',
        'summary' => 'Timing, frequency, triggers, recovery, and what remains normal help turn a vague worry into a clearer next step.',
        'notice' => ['When it started', 'How often it happens', 'What comes before and after', 'What helps and what remains normal'],
        'today' => ['Write one dated example', 'Save a short ordinary video', 'Choose the changed routine to observe next'],
        'vet' => 'Contact a veterinarian promptly for sudden, severe, rapidly worsening, or distressing changes.',
        'questions' => ['What should I track next?', 'What could make this urgent?', 'Which part of the routine matters most?'],
        'image' => '/media/real/photo-17.jpg',
    ];
    $item = $knowledge[$topic] ?? $fallback;
    $item['sources'] = $commonSources;
    return $item;
}

function buildLesson(array $pet, string $question, string $topic, array $context): array {
    $k = lessonKnowledge($topic);
    $name = clean($pet['dogName'] ?? 'your pet', 80);
    $species = strtolower(clean($pet['species'] ?? 'pet', 20));
    $breed = clean($pet['breed'] ?? 'breed not recorded', 100);
    $age = clean($pet['ageYears'] ?? 'age not recorded', 20);
    $conditions = clean($pet['healthConditions'] ?? '', 300);
    $medications = clean($pet['medications'] ?? '', 300);
    $moment = clean($context['changedMoment'] ?? $question, 500);
    $history = $conditions ? "Because {$name}'s profile includes {$conditions}, compare this new pattern with that known history without assuming they share one cause." : "Because no diagnosis is recorded in {$name}'s profile, keep the observation factual and avoid assuming a cause.";
    if ($medications) $history .= " Bring the current medication list ({$medications}) to the veterinary conversation; do not change doses from this lesson.";
    $facts = [['Pet', $name], ['Species', ucfirst($species)], ['Breed or type', $breed], ['Age', $age . ' years']];
    if ($conditions) $facts[] = ['Health history', $conditions];
    if ($medications) $facts[] = ['Medication context', $medications];
    $chapters = [
        [
            'number' => 1, 'title' => 'What this change can mean', 'image' => $k['image'],
            'paragraphs' => ["For {$name}, the useful starting point is not a diagnosis. It is the difference between today and {$name}'s own normal routine.", $k['summary'], $history],
            'bullets' => $k['notice'], 'marginNote' => $moment ? "You described: {$moment}" : "Add one exact example from an ordinary day.",
        ],
        [
            'number' => 2, 'title' => 'What to record over the next 24 hours', 'image' => $species === 'cat' ? '/media/real/photo-64.jpg' : '/media/real/photo-41.jpg',
            'paragraphs' => ["Record the first ordinary moment, not a staged repeat. Note the time, what happened before, how long it lasted, and how {$name} recovered.", 'A short video can help a veterinary team see movement or behavior that may not happen in the exam room.'],
            'bullets' => $k['notice'], 'marginNote' => 'Keep the record short enough that you will actually use it: one time, one example, one recovery note.',
        ],
        [
            'number' => 3, 'title' => 'What you can change safely today', 'image' => $species === 'cat' ? '/media/real/photo-69.jpg' : '/media/real/photo-45.jpg',
            'paragraphs' => ['Choose one low-risk environment change and observe whether the exact care moment becomes easier.', 'Do not add human medication, change a prescription, or start a supplement because of an online lesson.'],
            'bullets' => $k['today'], 'marginNote' => "The goal is a safer ordinary day for {$name}, not proving a theory.",
        ],
        [
            'number' => 4, 'title' => 'Prepare the veterinary conversation', 'image' => '/media/real/photo-52.jpg',
            'paragraphs' => ["Lead with the clearest change: when it began, how often it happens, what daily routine is affected, and what still seems normal for {$name}.", 'Ask what the plan is measuring, what improvement should look like, and when to call or return sooner.'],
            'bullets' => $k['questions'], 'marginNote' => $k['vet'],
        ],
    ];
    return [
        'bookTitle' => $name . "'s care knowledge book",
        'topic' => $topic,
        'title' => $k['title'] . ' for ' . $name,
        'petContext' => "{$name} is a {$age}-year-old {$breed} {$species}.",
        'summary' => $k['summary'],
        'evidenceNote' => 'This lesson combines the pet profile, the owner’s observation, and published veterinary owner guidance. It does not diagnose.',
        'profileFacts' => $facts,
        'pattern' => patternFrom($context),
        'chapters' => $chapters,
        'vet' => $k['vet'],
        'questions' => $k['questions'],
        'sources' => $k['sources'],
        'quiz' => [
            ['chapter' => 1, 'question' => 'Which record is most useful?', 'options' => ['A vague worry', 'One dated example with timing and recovery', 'A repeated staged test'], 'answer' => 1, 'explanation' => 'A dated ordinary example gives the clearest context.'],
            ['chapter' => 3, 'question' => 'Which action is safest before assessment?', 'options' => ['Give human pain medicine', 'Change prescription doses', 'Make one low-risk environment change'], 'answer' => 2, 'explanation' => 'Environment changes can reduce effort without changing treatment.'],
        ],
        'nextSteps' => [
            ['type' => 'link', 'label' => 'Find relevant care', 'href' => '/find-care/'],
            ['type' => 'link', 'label' => 'Prepare for a vet visit', 'href' => '/resources/checklists/vet-visit-questions/'],
            ['type' => 'link', 'label' => 'Shop practical support', 'href' => '/shop/'],
            ['type' => 'lesson', 'label' => 'Ask a follow-up', 'prompt' => "What should I record next for {$name}?"],
        ],
    ];
}

function defaultCommunity(): array {
    return [
        ['id' => 'public_mobility', 'dogName' => 'Milo’s family', 'topic' => 'Mobility & movement', 'body' => 'Milo began pausing before his first step after naps. We recorded the pause, first six steps, floor surface, and whether he loosened up.', 'createdAt' => '2026-08-01T09:00:00Z', 'helpfulCount' => 84, 'saveCount' => 126, 'replies' => [['dogName' => 'Luna’s family', 'body' => 'Recording the first rise gave our vet much better context.', 'createdAt' => '2026-08-02T09:00:00Z']], 'media' => []],
        ['id' => 'public_sleep', 'dogName' => 'Cleo’s family', 'topic' => 'Sleep & settling', 'body' => 'Cleo started waking at 2 a.m. We mapped wake time, pacing, water, litter-box visits, and what helped her settle.', 'createdAt' => '2026-08-03T09:00:00Z', 'helpfulCount' => 71, 'saveCount' => 104, 'replies' => [], 'media' => []],
        ['id' => 'public_appetite', 'dogName' => 'Bean’s family', 'topic' => 'Appetite & weight', 'body' => 'Bean still wanted treats but left regular food. Tracking amounts, chewing, water, stool, and weight helped us ask about dental pain and nausea.', 'createdAt' => '2026-08-05T09:00:00Z', 'helpfulCount' => 63, 'saveCount' => 93, 'replies' => [], 'media' => []],
        ['id' => 'public_litter', 'dogName' => 'Juniper’s family', 'topic' => 'Litter-box changes', 'body' => 'A lower-entry box reduced effort, but repeated small visits still needed a same-day veterinary call.', 'createdAt' => '2026-08-07T09:00:00Z', 'helpfulCount' => 92, 'saveCount' => 118, 'replies' => [], 'media' => []],
    ];
}

function communityRows(): array {
    $rowsById = [];
    foreach (defaultCommunity() as $post) $rowsById[$post['id']] = $post;
    foreach (readRows('community') as $post) {
        $postId = clean($post['id'] ?? '', 100);
        if ($postId !== '') $rowsById[$postId] = $post;
    }
    return array_values($rowsById);
}

function meetupContextCount(string $memberId, string $petId): int {
    $checkins = count(array_filter(readRows('checkins'), fn($item) => ($item['memberId'] ?? '') === $memberId && ($item['dogId'] ?? '') === $petId));
    $lessons = count(array_filter(readRows('conversations'), fn($item) => ($item['memberId'] ?? '') === $memberId && ($item['dogId'] ?? '') === $petId && ($item['status'] ?? '') !== 'intake'));
    return $checkins + $lessons;
}

function meetupProfile(string $memberId, string $petId): ?array {
    foreach (readRows('meetup-profiles') as $profile) {
        if (($profile['memberId'] ?? '') === $memberId && ($profile['petId'] ?? '') === $petId) return $profile;
    }
    return null;
}

function meetupProfileResponse(?array $profile): ?array {
    if (!$profile) return null;
    $fields = ['id', 'petId', 'city', 'region', 'country', 'radiusMiles', 'mixedSpeciesOk', 'sizeBand', 'energyLevel', 'temperament', 'mobilityNeeds', 'playStyle', 'availability', 'venuePreference', 'ownerGoal', 'safetyNotes', 'active'];
    $result = [];
    foreach ($fields as $field) $result[$field] = $profile[$field] ?? ($field === 'mixedSpeciesOk' || $field === 'active' ? false : '');
    return $result;
}

function meetupMatches(array $profile, string $memberId): array {
    $profiles = [];
    foreach (readRows('meetup-profiles') as $item) $profiles[$item['id'] ?? ''] = $item;
    $pets = [];
    foreach (readRows('pets') as $item) $pets[$item['id'] ?? ''] = $item;
    $members = [];
    foreach (readRows('members') as $item) $members[$item['id'] ?? ''] = $item;
    $feedback = readRows('meetup-feedback');
    $results = [];
    foreach (array_reverse(readRows('meetup-matches')) as $match) {
        $profileId = $profile['id'] ?? '';
        if (($match['profileAId'] ?? '') !== $profileId && ($match['profileBId'] ?? '') !== $profileId) continue;
        $otherId = ($match['profileAId'] ?? '') === $profileId ? ($match['profileBId'] ?? '') : ($match['profileAId'] ?? '');
        $other = $profiles[$otherId] ?? null;
        $pet = $other ? ($pets[$other['petId'] ?? ''] ?? null) : null;
        $owner = $other ? ($members[$other['memberId'] ?? ''] ?? null) : null;
        if (!$other || !$pet || !$owner) continue;
        $ownerName = clean($owner['ownerName'] ?? $owner['firstName'] ?? 'their person', 80);
        $submitted = count(array_filter($feedback, fn($item) => ($item['matchId'] ?? '') === ($match['id'] ?? '') && ($item['memberId'] ?? '') === $memberId)) > 0;
        $results[] = [
            'id' => $match['id'], 'score' => (int)($match['score'] ?? 0), 'reasons' => $match['reasons'] ?? [],
            'status' => $match['status'] ?? 'suggested', 'createdAt' => $match['createdAt'] ?? '',
            'petName' => $pet['dogName'] ?? 'A nearby pet', 'species' => $pet['species'] ?? '', 'breed' => $pet['breed'] ?? '',
            'city' => $other['city'] ?? '', 'region' => $other['region'] ?? '',
            'ownerFirstName' => explode(' ', $ownerName)[0] ?: 'their person', 'feedbackSubmitted' => $submitted,
        ];
        if (count($results) >= 12) break;
    }
    return $results;
}

function meetupCandidateScore(array $self, array $candidate): array {
    $sameCity = strtolower((string)$self['city']) === strtolower((string)$candidate['city']);
    $score = $sameCity ? 40 : 25;
    $reasons = [$sameCity ? 'Both families are in ' . $self['city'] . '.' : 'Both families are in ' . $self['region'] . '.'];
    if (($self['availability'] ?? '') === ($candidate['availability'] ?? '')) { $score += 20; $reasons[] = 'Your available time matches.'; }
    if (($self['energyLevel'] ?? '') === ($candidate['energyLevel'] ?? '')) { $score += 15; $reasons[] = 'The pets have a similar energy level.'; }
    if (($self['playStyle'] ?? '') === ($candidate['playStyle'] ?? '')) { $score += 10; $reasons[] = 'Their preferred social style matches.'; }
    if (($self['ownerGoal'] ?? '') === ($candidate['ownerGoal'] ?? '')) { $score += 10; $reasons[] = 'The owners want the same kind of connection.'; }
    if (($self['sizeBand'] ?? '') === ($candidate['sizeBand'] ?? '')) $score += 5;
    return ['score' => min(100, $score), 'reasons' => array_slice($reasons, 0, 4)];
}

function communityResearchBrief(string $query, string $species): array {
    $petLabel = $species === 'cat' ? 'cat' : ($species === 'dog' ? 'dog' : 'pet');
    if (preg_match('/food|diet|meal|nutrition|treat|appetite/i', $query)) {
        return [
            'title' => 'Food and routine brief',
            'prompts' => [
                "Name your {$petLabel}'s age, current food, medication, and the exact routine change.",
                'Separate a changed appetite from a changed food preference, timing, bowl location, or feeding setup.',
                'Ask your veterinary team what needs assessment before making a major diet change.',
            ],
        ];
    }
    if (preg_match('/bed|sleep|rest|night|settle|pacing/i', $query)) {
        return [
            'title' => 'Rest and settling brief',
            'prompts' => [
                'Describe the sleep location, the first wake-up, and the moment settling becomes difficult.',
                'Note whether movement, bathroom trips, temperature, noise, or a new routine changes the night.',
                'Keep one short ordinary video if it is safe and useful for a veterinary conversation.',
            ],
        ];
    }
    if (preg_match('/toy|play|walk|move|mobility|stair|jump|exercise/i', $query)) {
        return [
            'title' => 'Movement and engagement brief',
            'prompts' => [
                'Start with the first rise, first steps, or first choice to join an activity.',
                'Note what your pet avoids, how long recovery takes, and what makes the route easier.',
                'Ask whether a new or worsening change should be assessed before changing activity.',
            ],
        ];
    }
    return [
        'title' => 'Care question brief',
        'prompts' => [
            "Describe the ordinary routine for your {$petLabel}, then name the first detail that changed.",
            'Add when it happens, how often it repeats, and what seems to help.',
            'Keep the question specific enough for another owner or veterinary team to understand the real moment.',
        ],
    ];
}

function productCatalog(): array {
    return [
        'living-memorial-tree' => ['slug' => 'living-memorial-tree', 'title' => 'Living Memorial Tree', 'category' => 'Living memorials', 'priceCents' => 7900, 'imageUrl' => '/media/store/products/memorial-tree.jpg', 'shortDescription' => 'A living tribute with a personalized certificate.', 'details' => ['Tree-planting contribution', 'Personalized digital certificate', 'Gift-ready remembrance note']],
        'photo-collar-memory-frame' => ['slug' => 'photo-collar-memory-frame', 'title' => 'Pet Portrait Memory Frame', 'category' => 'Frames', 'priceCents' => 8200, 'imageUrl' => '/media/store/products/memory-frame.jpg', 'shortDescription' => 'A portrait frame made to hold a favorite photograph and collar.', 'details' => ['Portrait opening', 'Collar display', 'Personalization proof']],
        'portrait-name-pendant' => ['slug' => 'portrait-name-pendant', 'title' => 'Pet Photo Memory Locket', 'category' => 'Jewelry', 'priceCents' => 6800, 'imageUrl' => '/media/store/products/photo-locket.jpg', 'shortDescription' => 'A personalized keepsake for a name and favorite image.', 'details' => ['Photo proof', 'Name engraving', 'Gift box']],
        'hand-thrown-ceramic-urn' => ['slug' => 'hand-thrown-ceramic-urn', 'title' => 'Pawprint Bio Pet Urn', 'category' => 'Urns', 'priceCents' => 14800, 'imageUrl' => '/media/store/products/pet-urn.jpg', 'shortDescription' => 'A quiet resting place with a personalized paw detail.', 'details' => ['Capacity guide', 'Personalization proof', 'Protective packaging']],
        'portrait-signet-ring' => ['slug' => 'portrait-signet-ring', 'title' => 'Two Hearts Keepsake Ring', 'category' => 'Jewelry', 'priceCents' => 9400, 'imageUrl' => '/media/store/products/keepsake-ring.jpg', 'shortDescription' => 'A wearable keepsake with a name or short inscription.', 'details' => ['Sizing guide', 'Inscription proof', 'Gift box']],
        'paw-print-bracelet' => ['slug' => 'paw-print-bracelet', 'title' => 'Linked Memory Bracelet', 'category' => 'Jewelry', 'priceCents' => 5800, 'imageUrl' => '/media/store/products/memory-bracelet.jpg', 'shortDescription' => 'A personalized bracelet made for everyday remembrance.', 'details' => ['Adjustable fit', 'Name or paw detail', 'Gift box']],
        'custom-portrait-miniature' => ['slug' => 'custom-portrait-miniature', 'title' => 'Custom Portrait Miniature', 'category' => 'Personalized gifts', 'priceCents' => 12900, 'imageUrl' => '/media/store/products/portrait-miniature.jpg', 'shortDescription' => 'A small custom portrait made from your clearest photo.', 'details' => ['Artist proof', 'Display base', 'Gift packaging']],
        'custom-plush-portrait' => ['slug' => 'custom-plush-portrait', 'title' => 'Custom Plush Portrait', 'category' => 'Personalized gifts', 'priceCents' => 17900, 'imageUrl' => '/media/store/products/custom-plush.jpg', 'shortDescription' => 'A soft portrait inspired by your pet’s markings.', 'details' => ['Photo review', 'Color confirmation', 'Tracked delivery']],
        'senior-pet-home-comfort-consult' => ['slug' => 'senior-pet-home-comfort-consult', 'title' => 'Senior-Pet Home Comfort Consult', 'category' => 'Services', 'priceCents' => 9500, 'imageUrl' => '/media/store/products/home-consult.jpg', 'shortDescription' => 'A practical review of one daily care route at home.', 'details' => ['45-minute video call', 'Room-by-room notes', 'Action summary']],
    ];
}

$retiredCommerceApiPaths = [
    '/api/products',
    '/api/store-checkout',
    '/api/vendor-application',
    '/api/membership-interest',
    '/api/membership-checkout',
    '/api/stripe-webhook',
];
if (in_array($path, $retiredCommerceApiPaths, true)) {
    respond(410, ['error' => 'This commerce service has been retired. WoafMeow now focuses on education, care connections, Wednesday matching, and memorial-tree updates.']);
}

// Account and pet profiles.
if ($path === '/api/enroll' && $method === 'POST') {
    $input = inputBody();
    foreach (['ownerName', 'email', 'dogName', 'species', 'ageYears'] as $field) {
        if (clean($input[$field] ?? '') === '') respond(422, ['error' => 'Please complete every required account field.']);
    }
    if (!filter_var($input['email'], FILTER_VALIDATE_EMAIL)) respond(422, ['error' => 'Enter a valid email address.']);
    if (empty($input['consent'])) respond(422, ['error' => 'Please confirm care-account updates.']);
    $email = strtolower(clean($input['email'], 254));
    $members = readRows('members'); $existingIndex = null; $existingMember = null;
    foreach ($members as $index => $member) {
        if (strtolower(clean($member['email'] ?? '', 254)) === $email) { $existingIndex = $index; $existingMember = $member; break; }
    }
    $memberId = $existingMember['id'] ?? id('member');
    $pets = readRows('pets');
    $owned = array_values(array_filter($pets, fn($pet) => ($pet['memberId'] ?? '') === $memberId));
    if (count($owned) >= 5) respond(409, ['error' => 'This care account already has five pet profiles.']);
    $petId = id('pet'); $token = bin2hex(random_bytes(24)); $now = gmdate('c');
    $record = [
        'id' => $memberId, 'token' => $token, 'dogId' => $petId,
        'ownerName' => clean($input['ownerName'], 80), 'email' => $email,
        'city' => clean($input['city'], 80), 'region' => clean($input['region'], 100),
        'location' => clean(implode(', ', array_filter([$input['city'] ?? '', $input['region'] ?? ''])), 180),
        'dogName' => clean($input['dogName'], 80), 'species' => clean($input['species'], 20),
        'breed' => clean($input['breed'] ?? '', 120), 'ageYears' => clean($input['ageYears'], 10),
        'weightLbs' => clean($input['weightLbs'] ?? '', 10), 'focus' => clean($input['focus'] ?? 'not-sure', 50),
        'healthConditions' => clean($input['healthConditions'] ?? '', 700), 'medications' => clean($input['medications'] ?? '', 700),
        'routineNotes' => clean($input['routineNotes'] ?? '', 700), 'createdAt' => $existingMember['createdAt'] ?? $now,
        'updatedAt' => $now, 'source' => 'woafmeow.com',
    ];
    if ($existingIndex === null) $members[] = $record; else $members[$existingIndex] = $record;
    saveRows('members', $members);
    $pets[] = ['id' => $petId, 'memberId' => $memberId] + $record; saveRows('pets', $pets);
    saveSubmission('website-account', $record);
    respond(201, ['member' => $record, 'message' => $record['dogName'] . "'s account is ready."]);
}

if ($path === '/api/pets' && $method === 'GET') {
    $owner = requireMember();
    $pets = array_values(array_filter(readRows('pets'), fn($pet) => ($pet['memberId'] ?? '') === $owner['id']));
    respond(200, ['owner' => $owner, 'pets' => $pets]);
}

if ($path === '/api/pets' && $method === 'POST') {
    $input = inputBody(); $owner = requireMember($input);
    $pets = readRows('pets');
    $owned = array_values(array_filter($pets, fn($pet) => ($pet['memberId'] ?? '') === $owner['id']));
    if (count($owned) >= 5) respond(403, ['error' => 'Each care account supports up to five pet profiles.']);
    foreach (['dogName', 'species', 'ageYears'] as $field) if (clean($input[$field] ?? '') === '') respond(422, ['error' => 'Complete the pet name, species, and age.']);
    $pet = ['id' => id('pet'), 'memberId' => $owner['id'], 'dogName' => clean($input['dogName'], 80), 'species' => clean($input['species'], 20), 'breed' => clean($input['breed'] ?? '', 120), 'ageYears' => clean($input['ageYears'], 10), 'weightLbs' => clean($input['weightLbs'] ?? '', 10), 'focus' => clean($input['focus'] ?? 'not-sure', 50), 'healthConditions' => clean($input['healthConditions'] ?? '', 700), 'medications' => clean($input['medications'] ?? '', 700), 'routineNotes' => clean($input['routineNotes'] ?? '', 700), 'createdAt' => gmdate('c')];
    $pets[] = $pet; saveRows('pets', $pets);
    saveMemberAction('pet-profile-added', $owner, $pet, ['action' => 'pet profile added']);
    respond(201, ['pet' => $pet, 'message' => $pet['dogName'] . ' was added.']);
}

if ($path === '/api/pets' && $method === 'PATCH') {
    $input = inputBody(); $owner = requireMember($input); $petId = clean($input['dogId'] ?? '', 100);
    $pet = ownedPet($petId, $owner['id']);
    if (!$pet) respond(404, ['error' => 'We could not find that pet profile.']);
    foreach (['dogName', 'species', 'breed', 'ageYears', 'weightLbs', 'focus', 'healthConditions', 'medications', 'routineNotes', 'profileMediaId'] as $field) {
        if (array_key_exists($field, $input)) $pet[$field] = clean($input[$field], in_array($field, ['healthConditions', 'medications', 'routineNotes'], true) ? 700 : 120);
    }
    $pet['updatedAt'] = gmdate('c'); replaceRow('pets', $petId, $pet);
    if (($owner['dogId'] ?? '') === $petId) {
        foreach (['dogName', 'species', 'breed', 'ageYears', 'weightLbs', 'focus', 'healthConditions', 'medications', 'routineNotes', 'profileMediaId'] as $field) if (isset($pet[$field])) $owner[$field] = $pet[$field];
        replaceRow('members', $owner['id'], $owner);
    }
    saveMemberAction('pet-profile-updated', $owner, $pet, ['action' => 'pet profile updated']);
    respond(200, ['pet' => $pet, 'message' => $pet['dogName'] . "'s profile was updated."]);
}

// Care Circle intake, lessons, publishing, and public feed.
if ($path === '/api/care-chat' && $method === 'GET') {
    $owner = requireMember();
    $conversationId = clean($_GET['conversationId'] ?? '', 100);
    $items = array_values(array_filter(readRows('conversations'), fn($item) => ($item['memberId'] ?? '') === $owner['id'] && ($item['status'] ?? '') !== 'intake'));
    if ($conversationId) {
        foreach ($items as $item) if (($item['id'] ?? '') === $conversationId) respond(200, $item);
        respond(404, ['error' => 'We could not reopen that lesson.']);
    }
    $history = array_map(fn($item) => ['id' => $item['id'], 'title' => $item['answer']['title'] ?? $item['question'], 'topic' => topicName($item['answer']['topic'] ?? 'general'), 'privacy' => $item['privacy'] ?? 'public'], array_reverse($items));
    respond(200, ['conversations' => array_slice($history, 0, 30)]);
}

if ($path === '/api/care-chat' && $method === 'POST') {
    $input = inputBody(); $owner = requireMember($input); $petId = clean($input['dogId'] ?? $owner['dogId'] ?? '', 100);
    $pet = ownedPet($petId, $owner['id']);
    if (!$pet) respond(404, ['error' => 'We could not find that pet profile.']);
    $question = clean($input['question'] ?? '', 900); $stage = clean($input['stage'] ?? 'context', 20); $privacy = clean($input['privacy'] ?? 'public', 10) === 'private' ? 'private' : 'public';
    if (strlen($question) < 8) respond(422, ['error' => 'Tell us the change you noticed in one short sentence.']);
    $topic = topicFrom($question); $rows = readRows('conversations');
    $today = gmdate('Y-m-d');
    $used = count(array_filter($rows, fn($item) => ($item['memberId'] ?? '') === $owner['id'] && ($item['status'] ?? '') !== 'intake' && str_starts_with((string)($item['createdAt'] ?? ''), $today)));
    $limit = 20;
    if ($used >= $limit) {
        respond(429, ['error' => 'You have reached today’s care-lesson safety limit. Please continue tomorrow.', 'quota' => ['used' => $used, 'remaining' => 0, 'limit' => $limit]]);
    }
    $intakeKey = 'intake:' . hash('sha256', $question); $intakeIndex = null; $intake = null;
    foreach ($rows as $index => $item) {
        if (($item['memberId'] ?? '') === $owner['id'] && ($item['dogId'] ?? '') === $petId && ($item['title'] ?? '') === $intakeKey && ($item['status'] ?? '') === 'intake') {
            $intakeIndex = $index; $intake = $item; break;
        }
    }
    if ($stage === 'context') {
        if ($intakeIndex === null) {
            $now = gmdate('c');
            $intake = ['id' => id('intake'), 'memberId' => $owner['id'], 'dogId' => $petId, 'title' => $intakeKey, 'topic' => $topic, 'privacy' => $privacy, 'status' => 'intake', 'createdAt' => $now, 'updatedAt' => $now];
            $rows[] = $intake; saveRows('conversations', $rows);
            saveMemberAction('care-question-started', $owner, $pet, ['action' => 'care question started', 'topic' => topicName($topic), 'status' => $privacy]);
        }
        respond(200, ['needsContext' => true, 'question' => $question, 'privacy' => $privacy, 'intakeId' => $intake['id'], 'intake' => ['intro' => "I’ll ask only what helps make this specific to " . $pet['dogName'] . '.', 'questions' => intakeQuestions($topic, $pet)], 'quota' => ['used' => $used, 'remaining' => max(0, $limit - $used), 'limit' => $limit]]);
    }
    $context = is_array($input['context'] ?? null) ? $input['context'] : [];
    $now = gmdate('c');
    $conversation = ['id' => $intake['id'] ?? id('conversation'), 'memberId' => $owner['id'], 'dogId' => $petId, 'question' => $question, 'privacy' => $privacy, 'answer' => buildLesson($pet, $question, $topic, $context), 'published' => false, 'status' => 'active', 'createdAt' => $now, 'updatedAt' => $now];
    if ($intakeIndex === null) $rows[] = $conversation; else $rows[$intakeIndex] = $conversation;
    saveRows('conversations', $rows); $used++;
    saveMemberAction('care-lesson-created', $owner, $pet, ['action' => 'care lesson created', 'topic' => topicName($topic), 'status' => $privacy], $intakeIndex === null);
    respond(201, $conversation + ['conversationId' => $conversation['id'], 'quota' => ['used' => $used, 'remaining' => max(0, $limit - $used), 'limit' => $limit]]);
}

if ($path === '/api/care-chat-publish' && $method === 'POST') {
    $input = inputBody(); $owner = requireMember($input); $conversationId = clean($input['conversationId'] ?? '', 100);
    $rows = readRows('conversations'); $conversation = null;
    foreach ($rows as $index => $row) {
        if (($row['id'] ?? '') === $conversationId && ($row['memberId'] ?? '') === $owner['id']) {
            $row['published'] = true; $row['privacy'] = 'public'; $rows[$index] = $row; $conversation = $row; break;
        }
    }
    if (!$conversation) respond(404, ['error' => 'We could not find that lesson.']);
    saveRows('conversations', $rows);
    $pet = ownedPet((string)$conversation['dogId'], $owner['id']);
    $posts = readRows('community');
    $posts[] = ['id' => id('post'), 'conversationId' => $conversationId, 'memberId' => $owner['id'], 'dogName' => $pet['dogName'] ?? 'A pet family', 'topic' => topicName($conversation['answer']['topic'] ?? 'general'), 'body' => $conversation['question'], 'createdAt' => gmdate('c'), 'helpfulCount' => 0, 'saveCount' => 0, 'replies' => [], 'media' => []];
    saveRows('community', $posts);
    saveMemberAction('care-lesson-published', $owner, $pet ?: [], ['action' => 'care lesson published', 'conversationId' => $conversationId, 'topic' => topicName($conversation['answer']['topic'] ?? 'general')]);
    respond(201, ['message' => 'Your lesson is now visible in the public Care Circle.']);
}

if ($path === '/api/circles' && $method === 'GET') {
    $owner = authenticatedMember();
    $memberships = readRows('care-circle-group-members');
    $groups = [];
    $pendingGroups = [];
    foreach (readRows('care-circle-groups') as $group) {
        $memberCount = count(array_filter($memberships, fn($item) => ($item['groupId'] ?? '') === ($group['id'] ?? '')));
        $role = '';
        if ($owner) {
            foreach ($memberships as $membership) {
                if (($membership['groupId'] ?? '') === ($group['id'] ?? '') && ($membership['memberId'] ?? '') === $owner['id']) {
                    $role = clean($membership['role'] ?? '', 20);
                    break;
                }
            }
        }
        if (($group['status'] ?? '') === 'approved') {
            $groups[] = $group + ['memberCount' => $memberCount, 'isJoined' => $role !== '', 'isHost' => $role === 'host'];
        } elseif ($owner && ($group['hostMemberId'] ?? '') === $owner['id'] && ($group['status'] ?? '') === 'pending') {
            $pendingGroups[] = $group;
        }
    }
    usort($groups, fn($a, $b) => strcmp((string)($b['createdAt'] ?? ''), (string)($a['createdAt'] ?? '')));
    usort($pendingGroups, fn($a, $b) => strcmp((string)($b['createdAt'] ?? ''), (string)($a['createdAt'] ?? '')));
    respond(200, ['groups' => $groups, 'pendingGroups' => array_slice($pendingGroups, 0, 12)]);
}

if ($path === '/api/circles' && $method === 'POST') {
    $input = inputBody(); $owner = requireMember($input); $petId = clean($input['dogId'] ?? '', 100); $pet = ownedPet($petId, $owner['id']);
    if (!$pet) respond(404, ['error' => 'We could not find that pet profile.']);
    $kind = clean($input['kind'] ?? '', 12); $now = gmdate('c');
    if ($kind === 'create') {
        $title = clean($input['title'] ?? '', 110); $description = clean($input['description'] ?? '', 560);
        $focus = clean($input['focus'] ?? '', 32); $species = strtolower(clean($input['species'] ?? '', 12)); $cadence = clean($input['cadence'] ?? '', 20);
        if (strlen($title) < 8) respond(422, ['error' => 'Give your circle a clear, welcoming name.']);
        if (strlen($description) < 32) respond(422, ['error' => 'Add a little context so the right owners know why this circle could help.']);
        if (!in_array($focus, ['mobility', 'sleep', 'appetite', 'comfort', 'recovery', 'quality-of-life', 'daily-routine', 'vet-visit'], true)) respond(422, ['error' => 'Choose the part of care this circle is centered on.']);
        if (!in_array($species, ['dog', 'cat', 'all'], true)) respond(422, ['error' => 'Choose whether this circle is for older dogs, cats, or both.']);
        if (!in_array($cadence, ['weekly', 'twice-monthly', 'as-needed'], true)) respond(422, ['error' => 'Choose how often the group hopes to check in.']);
        $group = [
            'id' => id('circle'), 'hostMemberId' => $owner['id'], 'hostDogProfileId' => $petId,
            'hostDogName' => $pet['dogName'], 'title' => $title, 'description' => $description,
            'focus' => $focus, 'species' => $species, 'cadence' => $cadence,
            'status' => 'pending', 'createdAt' => $now, 'updatedAt' => $now,
        ];
        $groups = readRows('care-circle-groups'); $groups[] = $group; saveRows('care-circle-groups', $groups);
        $memberships = readRows('care-circle-group-members');
        $memberships[] = ['groupId' => $group['id'], 'memberId' => $owner['id'], 'role' => 'host', 'createdAt' => $now];
        saveRows('care-circle-group-members', $memberships);
        saveMemberAction('care-circle-host-application', $owner, $pet, ['action' => 'host application saved', 'topic' => $focus, 'status' => 'pending']);
        respond(201, ['message' => 'Your Care Circle is saved. We will check the invitation for clarity and a welcoming purpose before opening it to other owners.', 'group' => ['id' => $group['id'], 'title' => $title, 'status' => 'pending']]);
    }
    if ($kind === 'join') {
        $groupId = clean($input['groupId'] ?? '', 100); $group = null;
        foreach (readRows('care-circle-groups') as $candidate) if (($candidate['id'] ?? '') === $groupId && ($candidate['status'] ?? '') === 'approved') { $group = $candidate; break; }
        if (!$group) respond(404, ['error' => 'That Care Circle is no longer available.']);
        $memberships = readRows('care-circle-group-members'); $joined = false;
        foreach ($memberships as $membership) if (($membership['groupId'] ?? '') === $groupId && ($membership['memberId'] ?? '') === $owner['id']) { $joined = true; break; }
        if (!$joined) {
            $memberships[] = ['groupId' => $groupId, 'memberId' => $owner['id'], 'role' => 'member', 'createdAt' => $now];
            saveRows('care-circle-group-members', $memberships);
        }
        saveMemberAction('care-circle-joined', $owner, $pet, ['action' => $joined ? 'join confirmed' : 'circle joined', 'result' => $groupId]);
        respond(200, ['message' => 'You are part of ' . $group['title'] . '. You can now share an update with this circle.']);
    }
    respond(422, ['error' => 'We could not understand that Care Circle action.']);
}

if ($path === '/api/community' && $method === 'GET') {
    $posts = communityRows();
    usort($posts, fn($a, $b) => strcmp((string)($b['createdAt'] ?? ''), (string)($a['createdAt'] ?? '')));
    respond(200, ['posts' => $posts]);
}

if ($path === '/api/community' && $method === 'POST') {
    $input = inputBody(); $owner = requireMember($input); $pet = ownedPet(clean($input['dogId'] ?? '', 100), $owner['id']);
    if (!$pet) respond(404, ['error' => 'We could not find that pet profile.']);
    $kind = clean($input['kind'] ?? 'post', 20); $text = clean($input['body'] ?? '', 900);
    if ($kind === 'reply') {
        if (strlen($text) < 8) respond(422, ['error' => 'Add enough detail to make the reply useful.']);
        $posts = readRows('community'); $postId = clean($input['postId'] ?? '', 100); $found = false;
        foreach ($posts as $index => $post) if (($post['id'] ?? '') === $postId) { $post['replies'][] = ['dogName' => $pet['dogName'] . '’s family', 'body' => $text, 'createdAt' => gmdate('c')]; $posts[$index] = $post; $found = true; }
        if (!$found) {
            foreach (defaultCommunity() as $post) {
                if (($post['id'] ?? '') !== $postId) continue;
                $post['replies'][] = ['dogName' => $pet['dogName'] . '’s family', 'body' => $text, 'createdAt' => gmdate('c')];
                $posts[] = $post; $found = true; break;
            }
        }
        if (!$found) respond(404, ['error' => 'That public lesson is no longer available.']);
        saveRows('community', $posts);
        saveMemberAction('care-circle-reply', $owner, $pet, ['action' => 'reply added', 'postId' => $postId]);
        respond(201, ['message' => 'Your reply is now part of this conversation.']);
    }
    if (strlen($text) < 20) respond(422, ['error' => 'Add one concrete moment so another family can understand.']);
    $post = ['id' => id('post'), 'memberId' => $owner['id'], 'dogName' => $pet['dogName'] . '’s family', 'topic' => clean($input['topic'] ?? 'Daily routine', 50), 'body' => $text, 'createdAt' => gmdate('c'), 'helpfulCount' => 0, 'saveCount' => 0, 'replies' => [], 'media' => []];
    $posts = readRows('community'); $posts[] = $post; saveRows('community', $posts);
    saveMemberAction('care-circle-update', $owner, $pet, ['action' => 'update added', 'postId' => $post['id'], 'topic' => $post['topic']]);
    respond(201, ['message' => 'Your update is now visible in Care Circle.', 'post' => $post]);
}

if ($path === '/api/public-lesson' && $method === 'GET') {
    $postId = clean($_GET['postId'] ?? '', 100); $posts = communityRows();
    foreach ($posts as $post) if (($post['id'] ?? '') === $postId) {
        $pet = ['dogName' => preg_replace('/[’\']s family$/u', '', (string)$post['dogName']), 'species' => str_contains(strtolower((string)$post['topic']), 'litter') ? 'cat' : 'pet', 'breed' => 'profile shared privately', 'ageYears' => 'senior'];
        $topic = topicFrom((string)$post['body'] . ' ' . (string)$post['topic']);
        respond(200, ['conversationId' => $postId, 'question' => $post['body'], 'privacy' => 'public', 'published' => true, 'answer' => buildLesson($pet, $post['body'], $topic, ['when' => 'month', 'frequency' => 'daily', 'impact' => 'moderate', 'changedMoment' => $post['body']])]);
    }
    respond(404, ['error' => 'That public lesson is no longer available.']);
}

if ($path === '/api/community-action' && $method === 'POST') {
    $input = inputBody(); $owner = requireMember($input); $postId = clean($input['postId'] ?? '', 100); $action = clean($input['action'] ?? '', 20);
    $rows = readRows('community-actions'); $key = $owner['id'] . ':' . $postId . ':' . $action; $exists = false;
    foreach ($rows as $index => $row) if (($row['key'] ?? '') === $key) { unset($rows[$index]); $exists = true; }
    if (!$exists) $rows[] = ['key' => $key, 'memberId' => $owner['id'], 'postId' => $postId, 'action' => $action, 'createdAt' => gmdate('c')];
    saveRows('community-actions', $rows);
    saveMemberAction('care-circle-action', $owner, [], ['action' => $action . ($exists ? ' removed' : ' added'), 'postId' => $postId]);
    respond(200, ['active' => !$exists]);
}

if ($path === '/api/community-research' && $method === 'GET') {
    $owner = requireMember(); $petId = clean($_GET['dogId'] ?? '', 100); $pet = ownedPet($petId, $owner['id']);
    if (!$pet) respond(404, ['error' => 'We could not find that pet account.']);
    $today = gmdate('Y-m-d'); $history = []; $used = 0;
    foreach (readRows('community-research-queries') as $item) {
        if (($item['memberId'] ?? '') !== $owner['id']) continue;
        $history[] = $item;
        if (str_starts_with((string)($item['createdAt'] ?? ''), $today)) $used++;
    }
    usort($history, fn($a, $b) => strcmp((string)($b['createdAt'] ?? ''), (string)($a['createdAt'] ?? '')));
    respond(200, ['quota' => ['limit' => 3, 'used' => $used, 'remaining' => max(0, 3 - $used)], 'history' => array_slice($history, 0, 8)]);
}

if ($path === '/api/community-research' && $method === 'POST') {
    $input = inputBody(); $owner = requireMember($input); $petId = clean($input['dogId'] ?? '', 100); $pet = ownedPet($petId, $owner['id']);
    if (!$pet) respond(404, ['error' => 'We could not find that pet account.']);
    $query = clean($input['query'] ?? '', 180); $species = strtolower(clean($input['species'] ?? '', 12));
    $publicFacebookUrl = clean($input['publicFacebookUrl'] ?? '', 500);
    if (strlen($query) < 3) respond(422, ['error' => 'Write the topic or question you want to research.']);
    if (!in_array($species, ['dog', 'cat', 'all'], true)) respond(422, ['error' => 'Choose dog, cat, or both.']);
    if ($publicFacebookUrl !== '') {
        $validUrl = filter_var($publicFacebookUrl, FILTER_VALIDATE_URL);
        $scheme = strtolower((string)parse_url($publicFacebookUrl, PHP_URL_SCHEME));
        if (!$validUrl || !in_array($scheme, ['http', 'https'], true)) respond(422, ['error' => 'Use a complete public link, including https://, or leave it blank.']);
    }
    $today = gmdate('Y-m-d'); $rows = readRows('community-research-queries');
    $used = count(array_filter($rows, fn($item) => ($item['memberId'] ?? '') === $owner['id'] && str_starts_with((string)($item['createdAt'] ?? ''), $today)));
    if ($used >= 3) respond(429, ['error' => 'You have used today’s three free research requests. Try again tomorrow.']);
    $brief = communityResearchBrief($query, $species); $now = gmdate('c');
    $item = [
        'id' => id('research'), 'memberId' => $owner['id'], 'dogId' => $petId, 'query' => $query,
        'species' => $species, 'publicFacebookUrl' => $publicFacebookUrl,
        'sourceScope' => 'reddit_and_public_facebook', 'status' => 'source_access_pending',
        'brief' => $brief, 'createdAt' => $now,
    ];
    $rows[] = $item; saveRows('community-research-queries', $rows);
    saveMemberAction('community-research-request', $owner, $pet, ['action' => 'research brief saved', 'species' => $species]);
    respond(201, [
        'message' => 'Your research brief is saved in your account.', 'brief' => $brief,
        'quota' => ['limit' => 3, 'used' => $used + 1, 'remaining' => 2 - $used],
        'sourceStatus' => 'Public-source access is being configured. This request has not read Reddit or Facebook content, and it never searches private groups.',
    ]);
}

// Daily check-in, notifications, memories, and media.
if ($path === '/api/checkin' && $method === 'GET') {
    $owner = requireMember(); $petId = clean($_GET['dogId'] ?? $owner['dogId'] ?? '', 100);
    $items = array_values(array_filter(readRows('checkins'), fn($item) => ($item['memberId'] ?? '') === $owner['id'] && ($item['dogId'] ?? '') === $petId));
    respond(200, ['checkins' => array_reverse($items)]);
}

if ($path === '/api/checkin' && $method === 'POST') {
    $input = inputBody(); $owner = requireMember($input); $petId = clean($input['dogId'] ?? '', 100); $pet = ownedPet($petId, $owner['id']);
    if (!$pet) respond(404, ['error' => 'We could not find that pet profile.']);
    $item = ['id' => id('checkin'), 'memberId' => $owner['id'], 'dogId' => $petId, 'sleep' => clean($input['sleep'] ?? '', 50), 'mobility' => clean($input['mobility'] ?? '', 50), 'appetite' => clean($input['appetite'] ?? '', 50), 'note' => clean($input['note'] ?? $input['observation'] ?? '', 700), 'day' => clean($input['day'] ?? gmdate('Y-m-d'), 30), 'createdAt' => gmdate('c')];
    $rows = readRows('checkins'); $rows[] = $item; saveRows('checkins', $rows);
    $summary = $pet['dogName'] . '’s day: movement ' . ($item['mobility'] ?: 'not recorded') . ', appetite ' . ($item['appetite'] ?: 'not recorded') . ', sleep ' . ($item['sleep'] ?: 'not recorded') . '.';
    saveMemberAction('daily-glance-saved', $owner, $pet, ['action' => 'daily glance saved', 'status' => $item['day']]);
    respond(201, ['checkin' => $item, 'message' => 'Today’s note was saved.', 'summary' => $summary]);
}

if ($path === '/api/meetups' && $method === 'GET') {
    $owner = requireMember(); $petId = clean($_GET['petId'] ?? '', 100); $pet = ownedPet($petId, $owner['id']);
    if (!$pet) respond(401, ['error' => 'Enroll your pet before opening meetup matching.']);
    $contextCount = meetupContextCount($owner['id'], $petId); $profile = meetupProfile($owner['id'], $petId);
    respond(200, [
        'profile' => meetupProfileResponse($profile), 'matches' => $profile ? meetupMatches($profile, $owner['id']) : [],
        'contextCount' => $contextCount, 'requiredContextCount' => 3, 'unlocked' => $contextCount >= 3,
    ]);
}

if ($path === '/api/meetups' && $method === 'POST') {
    $input = inputBody(); $owner = requireMember($input); $petId = clean($input['petId'] ?? '', 100); $pet = ownedPet($petId, $owner['id']);
    if (!$pet) respond(401, ['error' => 'Enroll your pet before using meetup matching.']);
    $contextCount = meetupContextCount($owner['id'], $petId);
    if ($contextCount < 3) respond(403, ['error' => 'Save ' . (3 - $contextCount) . ' more check-in or lesson before Wednesday matching opens.']);
    $action = clean($input['action'] ?? '', 20);

    switch ($action) {
        case 'profile':
            $city = clean($input['city'] ?? '', 80); $region = clean($input['region'] ?? '', 80); $country = strtoupper(clean($input['country'] ?? '', 2));
            $radiusMiles = max(2, min(50, (int)($input['radiusMiles'] ?? 10)));
            $choiceFields = [
                'sizeBand' => ['small', 'medium', 'large', 'extra-large'],
                'energyLevel' => ['low', 'moderate', 'high'],
                'temperament' => ['social', 'selective', 'prefers-space'],
                'mobilityNeeds' => ['typical', 'gentle', 'limited'],
                'playStyle' => ['quiet-company', 'parallel-walk', 'gentle-play', 'active-play'],
                'availability' => ['weekday-morning', 'weekday-evening', 'weekend-morning', 'weekend-afternoon'],
                'venuePreference' => ['quiet-park', 'walking-route', 'pet-friendly-cafe', 'private-yard'],
                'ownerGoal' => ['gentle-social-time', 'walking-companion', 'shared-care-experience', 'pet-friendship'],
            ];
            $choices = [];
            foreach ($choiceFields as $field => $allowed) {
                $choices[$field] = clean($input[$field] ?? '', 40);
                if (!in_array($choices[$field], $allowed, true)) respond(422, ['error' => 'Complete each matching field so we can protect the fit.']);
            }
            if ($city === '' || $region === '' || !in_array($country, ['US', 'CA'], true)) respond(422, ['error' => 'Complete each matching field so we can protect the fit.']);
            $profiles = readRows('meetup-profiles'); $existing = meetupProfile($owner['id'], $petId); $now = gmdate('c');
            $profile = [
                'id' => $existing['id'] ?? id('meetup_profile'), 'memberId' => $owner['id'], 'petId' => $petId,
                'city' => $city, 'region' => $region, 'country' => $country, 'radiusMiles' => $radiusMiles,
                'mixedSpeciesOk' => !empty($input['mixedSpeciesOk']), 'sizeBand' => $choices['sizeBand'],
                'energyLevel' => $choices['energyLevel'], 'temperament' => $choices['temperament'],
                'mobilityNeeds' => $choices['mobilityNeeds'], 'playStyle' => $choices['playStyle'],
                'availability' => $choices['availability'], 'venuePreference' => $choices['venuePreference'],
                'ownerGoal' => $choices['ownerGoal'], 'safetyNotes' => clean($input['safetyNotes'] ?? '', 500),
                'active' => true, 'createdAt' => $existing['createdAt'] ?? $now, 'updatedAt' => $now,
            ];
            $replaced = false;
            foreach ($profiles as $index => $row) if (($row['memberId'] ?? '') === $owner['id'] && ($row['petId'] ?? '') === $petId) { $profiles[$index] = $profile; $replaced = true; break; }
            if (!$replaced) $profiles[] = $profile;
            saveRows('meetup-profiles', $profiles);
            saveMemberAction('wednesday-match-profile-saved', $owner, $pet, ['action' => 'matching profile saved', 'city' => $city, 'region' => $region, 'country' => $country]);
            respond(200, ['message' => 'Matching preferences saved.', 'profile' => meetupProfileResponse($profile)]);

        case 'match':
            respond(409, ['error' => 'Profiles are reviewed offline each Wednesday. If there is a careful fit, the WoafMeow team will send the introduction by email.']);

        case 'feedback':
            $profile = meetupProfile($owner['id'], $petId); $matchId = clean($input['matchId'] ?? '', 100); $match = null;
            if (!$profile) respond(422, ['error' => 'Save meetup preferences before sharing feedback.']);
            foreach (readRows('meetup-matches') as $item) if (($item['id'] ?? '') === $matchId && (($item['profileAId'] ?? '') === $profile['id'] || ($item['profileBId'] ?? '') === $profile['id'])) { $match = $item; break; }
            if (!$match) respond(403, ['error' => 'That match is not connected to this pet.']);
            $ratings = [];
            foreach (['comfortRating', 'energyFitRating', 'ownerFitRating', 'safetyRating'] as $field) {
                $raw = $input[$field] ?? null; $rating = (int)$raw;
                if (!is_numeric($raw) || (float)$raw !== (float)$rating || $rating < 1 || $rating > 5) respond(422, ['error' => 'Rate each part from 1 to 5.']);
                $ratings[$field] = $rating;
            }
            $feedback = readRows('meetup-feedback'); $item = [
                'id' => id('meetup_feedback'), 'matchId' => $matchId, 'memberId' => $owner['id'],
                'comfortRating' => $ratings['comfortRating'], 'energyFitRating' => $ratings['energyFitRating'],
                'ownerFitRating' => $ratings['ownerFitRating'], 'safetyRating' => $ratings['safetyRating'],
                'meetAgain' => !empty($input['meetAgain']), 'notes' => clean($input['notes'] ?? '', 600), 'createdAt' => gmdate('c'),
            ];
            $replaced = false;
            foreach ($feedback as $index => $row) if (($row['matchId'] ?? '') === $matchId && ($row['memberId'] ?? '') === $owner['id']) { $item['id'] = $row['id'] ?? $item['id']; $feedback[$index] = $item; $replaced = true; break; }
            if (!$replaced) $feedback[] = $item;
            saveRows('meetup-feedback', $feedback);
            saveMemberAction('wednesday-match-feedback-saved', $owner, $pet, ['action' => 'match feedback saved', 'matchId' => $matchId, 'result' => $item['meetAgain'] ? 'meet again' : 'do not meet again']);
            respond(200, ['message' => 'Feedback saved. It will change how the next match is ranked.']);

        default:
            respond(422, ['error' => 'Choose a meetup action.']);
    }
}

if ($path === '/api/notifications' && $method === 'GET') {
    $owner = requireMember();
    $items = array_values(array_filter(readRows('notifications'), fn($item) => ($item['memberId'] ?? '') === $owner['id']));
    if (!$items) $items[] = ['id' => 'welcome_' . $owner['id'], 'kind' => 'welcome', 'title' => 'Your WoafMeow care space is ready', 'body' => 'Ask one specific question or save today’s ordinary moment.', 'href' => '/community/#ask', 'isRead' => false, 'createdAt' => $owner['createdAt'] ?? gmdate('c')];
    respond(200, ['notifications' => array_reverse($items), 'unreadCount' => count(array_filter($items, fn($item) => empty($item['isRead'])))]);
}

if ($path === '/api/notifications' && in_array($method, ['POST', 'PATCH'], true)) {
    $input = inputBody(); $owner = requireMember($input); $rows = readRows('notifications');
    foreach ($rows as $index => $item) if (($item['memberId'] ?? '') === $owner['id']) { $item['isRead'] = true; $rows[$index] = $item; }
    saveRows('notifications', $rows); respond(200, ['message' => 'Notifications marked as read.']);
}

if ($path === '/api/memories' && $method === 'GET') {
    $owner = requireMember(); $petId = clean($_GET['dogId'] ?? '', 100);
    $items = array_values(array_filter(readRows('memories'), fn($item) => ($item['memberId'] ?? '') === $owner['id'] && ($item['dogId'] ?? '') === $petId));
    respond(200, ['memories' => array_reverse($items)]);
}

if ($path === '/api/memories' && $method === 'POST') {
    $input = inputBody(); $owner = requireMember($input); $petId = clean($input['dogId'] ?? '', 100);
    $pet = ownedPet($petId, $owner['id']);
    if (!$pet) respond(404, ['error' => 'We could not find that pet profile.']);
    $item = ['id' => id('memory'), 'memberId' => $owner['id'], 'dogId' => $petId, 'title' => clean($input['title'] ?? '', 120), 'story' => clean($input['story'] ?? '', 1400), 'mediaId' => clean($input['mediaId'] ?? '', 100), 'createdAt' => gmdate('c')];
    if (!$item['title'] || !$item['story']) respond(422, ['error' => 'Add a title and the moment you want to remember.']);
    $rows = readRows('memories'); $rows[] = $item; saveRows('memories', $rows);
    saveMemberAction('private-memory-saved', $owner, $pet, ['action' => 'private memory saved', 'hasMedia' => $item['mediaId'] !== '' ? 'yes' : 'no']);
    respond(201, ['memory' => $item, 'message' => 'This moment was saved.']);
}

if ($path === '/api/media' && $method === 'POST') {
    $memberId = clean($_POST['memberId'] ?? '', 100); $token = clean($_POST['memberToken'] ?? '', 180); $owner = authenticatedMember(['memberId' => $memberId, 'memberToken' => $token]);
    if (!$owner) respond(401, ['error' => 'Please sign in again.']);
    $petId = clean($_POST['dogId'] ?? '', 100); $pet = ownedPet($petId, $owner['id']);
    if (!$pet) respond(404, ['error' => 'We could not find that pet profile.']);
    if (!isset($_FILES['file']) || $_FILES['file']['error'] !== UPLOAD_ERR_OK) respond(422, ['error' => 'Choose a photo, video, or audio file.']);
    $file = $_FILES['file'];
    if ((int)$file['size'] > 20 * 1024 * 1024) respond(413, ['error' => 'Keep uploads under 20 MB.']);
    $mime = mime_content_type($file['tmp_name']) ?: 'application/octet-stream';
    $allowed = ['image/jpeg' => 'jpg', 'image/png' => 'png', 'image/webp' => 'webp', 'video/mp4' => 'mp4', 'audio/mpeg' => 'mp3', 'audio/mp4' => 'm4a'];
    if (!isset($allowed[$mime])) respond(415, ['error' => 'Use JPG, PNG, WebP, MP4, MP3, or M4A.']);
    $mediaId = id('media'); $mediaDir = dataDir() . '/media'; if (!is_dir($mediaDir)) @mkdir($mediaDir, 0750, true);
    $target = $mediaDir . '/' . $mediaId . '.' . $allowed[$mime];
    if (!move_uploaded_file($file['tmp_name'], $target)) respond(503, ['error' => 'We could not save that file.']);
    $kind = str_starts_with($mime, 'image/') ? 'image' : (str_starts_with($mime, 'video/') ? 'video' : 'audio');
    $item = ['id' => $mediaId, 'memberId' => $owner['id'], 'dogId' => $petId, 'path' => $target, 'mimeType' => $mime, 'mediaKind' => $kind, 'createdAt' => gmdate('c')];
    $rows = readRows('media'); $rows[] = $item; saveRows('media', $rows);
    saveMemberAction('care-media-uploaded', $owner, $pet, ['action' => 'media uploaded', 'status' => $kind, 'hasMedia' => 'yes']);
    respond(201, ['media' => $item]);
}

if (preg_match('#^/api/media/([A-Za-z0-9_]+)$#', $path, $matches) && $method === 'GET') {
    $mediaId = $matches[1];
    foreach (readRows('media') as $item) if (($item['id'] ?? '') === $mediaId && is_file((string)$item['path'])) {
        header('content-type: ' . $item['mimeType']); header('cache-control: private, max-age=3600'); readfile($item['path']); exit;
    }
    respond(404, ['error' => 'That media file is unavailable.']);
}

// Product catalog and real Stripe Checkout handoff.
if ($path === '/api/products' && $method === 'GET') respond(200, ['products' => array_values(productCatalog())]);

if ($path === '/api/store-checkout' && $method === 'POST') {
    $input = inputBody(); $name = clean($input['name'] ?? '', 100); $email = strtolower(clean($input['email'] ?? '', 254));
    foreach (['phone', 'address1', 'city', 'region', 'postalCode', 'country'] as $field) if (clean($input[$field] ?? '') === '') respond(422, ['error' => 'Complete the delivery and contact details.']);
    if (!$name || !filter_var($email, FILTER_VALIDATE_EMAIL)) respond(422, ['error' => 'Add a valid name and email address.']);
    $catalog = productCatalog(); $items = [];
    foreach (array_slice(is_array($input['items'] ?? null) ? $input['items'] : [], 0, 20) as $requested) {
        $slug = clean($requested['slug'] ?? '', 100); if (!isset($catalog[$slug])) continue;
        $quantity = max(1, min(8, (int)($requested['quantity'] ?? 1))); $item = $catalog[$slug];
        $items[] = ['slug' => $slug, 'title' => $item['title'], 'priceCents' => $item['priceCents'], 'quantity' => $quantity, 'note' => clean($requested['note'] ?? '', 500)];
    }
    if (!$items) respond(422, ['error' => 'Your cart is empty.']);
    $subtotal = array_reduce($items, fn($sum, $item) => $sum + $item['priceCents'] * $item['quantity'], 0);
    $order = ['id' => id('order'), 'name' => $name, 'email' => $email, 'phone' => clean($input['phone'], 40), 'address1' => clean($input['address1'], 180), 'address2' => clean($input['address2'] ?? '', 120), 'city' => clean($input['city'], 100), 'region' => clean($input['region'], 100), 'postalCode' => clean($input['postalCode'], 24), 'country' => strtoupper(clean($input['country'], 2)), 'items' => $items, 'subtotalCents' => $subtotal, 'status' => 'checkout_pending', 'createdAt' => gmdate('c')];
    $orders = readRows('orders'); $orders[] = $order; saveRows('orders', $orders); saveSubmission('store-checkout', $order);
    $secret = getenv('STRIPE_SECRET_KEY') ?: '';
    if (!$secret || !function_exists('curl_init')) respond(503, ['error' => 'Secure payment is being connected. Your order details were saved; our team has been notified.', 'orderId' => $order['id']]);
    $params = ['mode' => 'payment', 'customer_email' => $email, 'success_url' => 'https://www.woafmeow.com/shop/?checkout=success&order=' . rawurlencode($order['id']), 'cancel_url' => 'https://www.woafmeow.com/shop/?checkout=cancelled', 'metadata[woafmeow_order_id]' => $order['id']];
    foreach ($items as $index => $item) {
        $params["line_items[$index][quantity]"] = (string)$item['quantity']; $params["line_items[$index][price_data][currency]"] = 'usd'; $params["line_items[$index][price_data][unit_amount]"] = (string)$item['priceCents']; $params["line_items[$index][price_data][product_data][name]"] = $item['title'];
    }
    $ch = curl_init('https://api.stripe.com/v1/checkout/sessions');
    curl_setopt_array($ch, [CURLOPT_POST => true, CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 20, CURLOPT_HTTPHEADER => ['Authorization: Bearer ' . $secret, 'Content-Type: application/x-www-form-urlencoded'], CURLOPT_POSTFIELDS => http_build_query($params)]);
    $raw = curl_exec($ch); $status = curl_getinfo($ch, CURLINFO_RESPONSE_CODE); curl_close($ch); $session = json_decode((string)$raw, true);
    if ($status < 200 || $status >= 300 || empty($session['url'])) respond(503, ['error' => $session['error']['message'] ?? 'Secure checkout could not be opened.', 'orderId' => $order['id']]);
    respond(200, ['checkoutUrl' => $session['url'], 'orderId' => $order['id']]);
}

// Every website form is stored, added to the WoafMeow Brevo list, and emailed.
$formRoutes = [
    '/api/newsletter' => 'newsletter-signup', '/api/waitlist' => 'care-list-signup', '/api/session-interest' => 'webinar-signup',
    '/api/memorial-interest' => 'memorial-interest', '/api/vendor-application' => 'vendor-application',
    '/api/membership-interest' => 'membership-interest', '/api/provider-inquiry' => 'provider-inquiry',
    '/api/contact' => 'contact-message',
];
if (isset($formRoutes[$path]) && $method === 'POST') {
    $input = inputBody(); $email = strtolower(clean($input['email'] ?? '', 254));
    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) respond(422, ['error' => 'Enter a valid email address.']);
    $record = [];
    foreach ($input as $key => $value) if (is_scalar($value)) $record[clean($key, 60)] = clean($value, 1000);
    $record['id'] = id('submission');
    $record['email'] = $email; saveSubmission($formRoutes[$path], $record);
    if ($path === '/api/newsletter') {
        $delivery = sendGuideEmail($email);
        $log = readRows('notification-log');
        $log[] = ['id' => id('notification'), 'submissionId' => $record['id'] ?? '', 'type' => 'senior-dog-guide-delivery', 'email' => $email, 'status' => $delivery['status'], 'detail' => $delivery['detail'], 'createdAt' => gmdate('c')];
        if (count($log) > 5000) $log = array_slice($log, -5000);
        saveRows('notification-log', $log);
        if ($delivery['status'] !== 'sent') respond(503, ['error' => 'We saved your address but could not deliver the guide. Please try again.']);
        respond(201, ['message' => 'The complete Senior Dog Care Guide has been emailed to you.']);
    }
    respond(201, ['message' => 'Thank you. We saved your information and will follow up.']);
}

if ($path === '/api/admin' && $method === 'GET') {
    $key = clean($_SERVER['HTTP_X_WOAFY_ADMIN_KEY'] ?? '', 200); $expected = getenv('ADMIN_DASHBOARD_KEY') ?: '';
    if (!$expected || !$key || !hash_equals($expected, $key)) respond(401, ['error' => 'Admin access required.']);
    respond(200, ['members' => readRows('members'), 'submissions' => array_reverse(readRows('submissions'))]);
}

respond(404, ['error' => 'That WoafMeow service is not available yet.']);
