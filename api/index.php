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
            'FIRSTNAME' => clean($record['ownerName'] ?? $record['name'] ?? '', 80),
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

function notifyOwner(string $subject, array $record): void {
    $destination = getenv('FORM_NOTIFICATION_EMAIL') ?: 'robert.luo@woafmeow.com';
    $lines = [];
    foreach ($record as $key => $value) {
        if (is_scalar($value) && trim((string)$value) !== '' && !in_array($key, ['token', 'memberToken'], true)) $lines[] = $key . ': ' . $value;
    }
    @mail($destination, $subject, implode("\n", $lines), "From: WoafMeow <no-reply@woafmeow.com>\r\n");
}

function saveSubmission(string $type, array $record): void {
    $record['id'] = $record['id'] ?? id('submission');
    $record['type'] = $type;
    $record['createdAt'] = $record['createdAt'] ?? gmdate('c');
    $rows = readRows('submissions');
    $rows[] = $record;
    saveRows('submissions', $rows);
    syncBrevo($record, 'woafmeow.com/' . $type);
    notifyOwner('New WoafMeow ' . str_replace('-', ' ', $type), $record);
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

// Account and pet profiles.
if ($path === '/api/enroll' && $method === 'POST') {
    $input = inputBody();
    foreach (['ownerName', 'email', 'city', 'region', 'dogName', 'species', 'breed', 'ageYears'] as $field) {
        if (clean($input[$field] ?? '') === '') respond(422, ['error' => 'Please complete every required account field.']);
    }
    if (!filter_var($input['email'], FILTER_VALIDATE_EMAIL)) respond(422, ['error' => 'Enter a valid email address.']);
    if (empty($input['consent'])) respond(422, ['error' => 'Please confirm care-account updates.']);
    $memberId = id('member'); $petId = id('pet'); $token = bin2hex(random_bytes(24));
    $record = [
        'id' => $memberId, 'token' => $token, 'dogId' => $petId,
        'ownerName' => clean($input['ownerName'], 80), 'email' => strtolower(clean($input['email'], 254)),
        'city' => clean($input['city'], 80), 'region' => clean($input['region'], 100),
        'location' => clean(($input['city'] ?? '') . ', ' . ($input['region'] ?? ''), 180),
        'dogName' => clean($input['dogName'], 80), 'species' => clean($input['species'], 20),
        'breed' => clean($input['breed'], 120), 'ageYears' => clean($input['ageYears'], 10),
        'weightLbs' => clean($input['weightLbs'] ?? '', 10), 'focus' => clean($input['focus'] ?? 'not-sure', 50),
        'healthConditions' => clean($input['healthConditions'] ?? '', 700), 'medications' => clean($input['medications'] ?? '', 700),
        'routineNotes' => clean($input['routineNotes'] ?? '', 700), 'plan' => 'free', 'createdAt' => gmdate('c'), 'source' => 'woafmeow.com',
    ];
    $members = readRows('members'); $members[] = $record; saveRows('members', $members);
    $pets = readRows('pets'); $pets[] = ['id' => $petId, 'memberId' => $memberId] + $record; saveRows('pets', $pets);
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
    if (($owner['plan'] ?? 'free') === 'free' && count($owned) >= 1) respond(403, ['error' => 'Free accounts include one pet. Care+ supports multiple pets.']);
    foreach (['dogName', 'species', 'breed', 'ageYears'] as $field) if (clean($input[$field] ?? '') === '') respond(422, ['error' => 'Complete the pet name, species, breed or type, and age.']);
    $pet = ['id' => id('pet'), 'memberId' => $owner['id'], 'dogName' => clean($input['dogName'], 80), 'species' => clean($input['species'], 20), 'breed' => clean($input['breed'], 120), 'ageYears' => clean($input['ageYears'], 10), 'weightLbs' => clean($input['weightLbs'] ?? '', 10), 'focus' => clean($input['focus'] ?? 'not-sure', 50), 'healthConditions' => clean($input['healthConditions'] ?? '', 700), 'medications' => clean($input['medications'] ?? '', 700), 'routineNotes' => clean($input['routineNotes'] ?? '', 700), 'createdAt' => gmdate('c')];
    $pets[] = $pet; saveRows('pets', $pets); respond(201, ['pet' => $pet, 'message' => $pet['dogName'] . ' was added.']);
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
    respond(200, ['pet' => $pet, 'message' => $pet['dogName'] . "'s profile was updated."]);
}

// Care Circle intake, lessons, publishing, and public feed.
if ($path === '/api/care-chat' && $method === 'GET') {
    $owner = requireMember();
    $conversationId = clean($_GET['conversationId'] ?? '', 100);
    $items = array_values(array_filter(readRows('conversations'), fn($item) => ($item['memberId'] ?? '') === $owner['id']));
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
    $topic = topicFrom($question);
    if ($stage === 'context') {
        respond(200, ['needsContext' => true, 'question' => $question, 'privacy' => $privacy, 'intake' => ['intro' => "I’ll ask only what helps make this specific to " . $pet['dogName'] . '.', 'questions' => intakeQuestions($topic, $pet)]]);
    }
    $rows = readRows('conversations');
    $today = gmdate('Y-m-d');
    $used = count(array_filter($rows, fn($item) => ($item['memberId'] ?? '') === $owner['id'] && str_starts_with((string)($item['createdAt'] ?? ''), $today)));
    $limit = ($owner['plan'] ?? 'free') === 'free' ? 2 : 50;
    if ($used >= $limit) {
        respond(429, ['error' => $limit === 2 ? 'You have used today’s two free lessons. Your lesson limit refreshes tomorrow.' : 'You have reached today’s lesson limit.', 'quota' => ['used' => $used, 'remaining' => 0, 'limit' => $limit]]);
    }
    $context = is_array($input['context'] ?? null) ? $input['context'] : [];
    $conversation = ['id' => id('conversation'), 'memberId' => $owner['id'], 'dogId' => $petId, 'question' => $question, 'privacy' => $privacy, 'answer' => buildLesson($pet, $question, $topic, $context), 'published' => false, 'createdAt' => gmdate('c')];
    $rows[] = $conversation; saveRows('conversations', $rows); $used++;
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
    respond(201, ['message' => 'Your lesson is now visible in the public Care Circle.']);
}

if ($path === '/api/community' && $method === 'GET') {
    $posts = array_merge(readRows('community'), defaultCommunity());
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
        if (!$found) respond(404, ['error' => 'That public lesson is no longer available.']);
        saveRows('community', $posts); respond(201, ['message' => 'Your reply is now part of this conversation.']);
    }
    if (strlen($text) < 20) respond(422, ['error' => 'Add one concrete moment so another family can understand.']);
    $post = ['id' => id('post'), 'memberId' => $owner['id'], 'dogName' => $pet['dogName'] . '’s family', 'topic' => clean($input['topic'] ?? 'Daily routine', 50), 'body' => $text, 'createdAt' => gmdate('c'), 'helpfulCount' => 0, 'saveCount' => 0, 'replies' => [], 'media' => []];
    $posts = readRows('community'); $posts[] = $post; saveRows('community', $posts); respond(201, ['message' => 'Your update is now visible in Care Circle.', 'post' => $post]);
}

if ($path === '/api/public-lesson' && $method === 'GET') {
    $postId = clean($_GET['postId'] ?? '', 100); $posts = array_merge(readRows('community'), defaultCommunity());
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
    saveRows('community-actions', $rows); respond(200, ['active' => !$exists]);
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
    $item = ['id' => id('checkin'), 'memberId' => $owner['id'], 'dogId' => $petId, 'sleep' => clean($input['sleep'] ?? '', 50), 'movement' => clean($input['movement'] ?? '', 50), 'appetite' => clean($input['appetite'] ?? '', 50), 'note' => clean($input['note'] ?? $input['observation'] ?? '', 700), 'day' => clean($input['day'] ?? gmdate('Y-m-d'), 30), 'createdAt' => gmdate('c')];
    $rows = readRows('checkins'); $rows[] = $item; saveRows('checkins', $rows);
    $summary = $pet['dogName'] . '’s day: movement ' . ($item['movement'] ?: 'not recorded') . ', appetite ' . ($item['appetite'] ?: 'not recorded') . ', sleep ' . ($item['sleep'] ?: 'not recorded') . '.';
    respond(201, ['checkin' => $item, 'message' => 'Today’s note was saved.', 'summary' => $summary]);
}

if ($path === '/api/notifications' && $method === 'GET') {
    $owner = requireMember();
    $items = array_values(array_filter(readRows('notifications'), fn($item) => ($item['memberId'] ?? '') === $owner['id']));
    if (!$items) $items[] = ['id' => 'welcome_' . $owner['id'], 'kind' => 'welcome', 'title' => 'Your WoafMeow care space is ready', 'body' => 'Ask one specific question or save today’s ordinary moment.', 'href' => '/community/#ask', 'isRead' => false, 'createdAt' => $owner['createdAt'] ?? gmdate('c')];
    respond(200, ['notifications' => array_reverse($items), 'unreadCount' => count(array_filter($items, fn($item) => empty($item['isRead'])))]);
}

if ($path === '/api/notifications' && $method === 'POST') {
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
    if (!ownedPet($petId, $owner['id'])) respond(404, ['error' => 'We could not find that pet profile.']);
    $item = ['id' => id('memory'), 'memberId' => $owner['id'], 'dogId' => $petId, 'title' => clean($input['title'] ?? '', 120), 'story' => clean($input['story'] ?? '', 1400), 'mediaId' => clean($input['mediaId'] ?? '', 100), 'createdAt' => gmdate('c')];
    if (!$item['title'] || !$item['story']) respond(422, ['error' => 'Add a title and the moment you want to remember.']);
    $rows = readRows('memories'); $rows[] = $item; saveRows('memories', $rows); respond(201, ['memory' => $item, 'message' => 'This moment was saved.']);
}

if ($path === '/api/media' && $method === 'POST') {
    $memberId = clean($_POST['memberId'] ?? '', 100); $token = clean($_POST['memberToken'] ?? '', 180); $owner = authenticatedMember(['memberId' => $memberId, 'memberToken' => $token]);
    if (!$owner) respond(401, ['error' => 'Please sign in again.']);
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
    $item = ['id' => $mediaId, 'memberId' => $owner['id'], 'dogId' => clean($_POST['dogId'] ?? '', 100), 'path' => $target, 'mimeType' => $mime, 'mediaKind' => $kind, 'createdAt' => gmdate('c')];
    $rows = readRows('media'); $rows[] = $item; saveRows('media', $rows); respond(201, ['media' => $item]);
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
    $record['email'] = $email; saveSubmission($formRoutes[$path], $record);
    respond(201, ['message' => $path === '/api/newsletter' ? 'You are on the WoafMeow care list.' : 'Thank you. We saved your information and will follow up.']);
}

if ($path === '/api/admin' && $method === 'GET') {
    $key = clean($_SERVER['HTTP_X_WOAFY_ADMIN_KEY'] ?? '', 200); $expected = getenv('ADMIN_DASHBOARD_KEY') ?: '';
    if (!$expected || !$key || !hash_equals($expected, $key)) respond(401, ['error' => 'Admin access required.']);
    respond(200, ['members' => readRows('members'), 'submissions' => array_reverse(readRows('submissions')), 'orders' => array_reverse(readRows('orders')), 'products' => array_values(productCatalog())]);
}

respond(404, ['error' => 'That WoafMeow service is not available yet.']);
