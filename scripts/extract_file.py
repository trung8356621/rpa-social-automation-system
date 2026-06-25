import json

transcript_path = r'C:\Users\Admin\.cursor\projects\d-work-app-rpa-social-automation-system\agent-transcripts\acad1c4f-8a4b-4f8f-8e06-4c85dcd68487\acad1c4f-8a4b-4f8f-8e06-4c85dcd68487.jsonl'
output_path = r'D:\work-app\rpa-social-automation-system\src\renderer\components\ScenarioEditor.jsx'

with open(transcript_path, 'r', encoding='utf-8') as f:
    for line in f:
        obj = json.loads(line)
        msg = obj.get('message', {})
        content = msg.get('content', [])
        if isinstance(content, list):
            for item in content:
                if isinstance(item, dict):
                    # Look for Write tool calls that wrote to ScenarioEditor.jsx
                    if item.get('type') == 'tool_use' and item.get('name') == 'Write':
                        inp = item.get('input', {})
                        if 'ScenarioEditor.jsx' in inp.get('path', ''):
                            file_content = inp.get('contents', '')
                            with open(output_path, 'w', encoding='utf-8') as of:
                                of.write(file_content)
                            print(f'FOUND: {len(file_content)} bytes')
                            exit(0)
print('NOT FOUND')
