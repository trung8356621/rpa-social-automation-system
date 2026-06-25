import json, re
transcript_path = r'C:\Users\Admin\.cursor\projects\d-work-app-rpa-social-automation-system\agent-transcripts\acad1c4f-8a4b-4f8f-8e06-4c85dcd68487\acad1c4f-8a4b-4f8f-8e06-4c85dcd68487.jsonl'
out_path = r'D:\work-app\rpa-social-automation-system\src\renderer\components\ScenarioEditor.jsx'

with open(transcript_path, 'r', encoding='utf-8') as f:
    for line in f:
        try:
            obj = json.loads(line)
            if obj.get('role') == 'assistant':
                content = obj.get('content', '')
                if 'function ProgramMonitor' in content and 'export default function ScenarioEditor' in content:
                    blocks = re.findall(r'```(?:jsx?)?\n(.*?)```', content, re.DOTALL)
                    for b in blocks:
                        if 'export default function ScenarioEditor' in b:
                            with open(out_path, 'w', encoding='utf-8') as of:
                                of.write(b)
                            print('OK', len(b))
                            exit(0)
        except:
            pass
print('NOT FOUND')
exit(1)
