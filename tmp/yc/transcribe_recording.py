from pathlib import Path
import sys
import json
import wave

HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE/'python-deps'))
from faster_whisper import WhisperModel
import numpy as np

model_path=Path('C:/Users/chauh/.cache/huggingface/hub/models--Systran--faster-whisper-base.en/snapshots/3d3d5dee26484f91867d81cb899cfcf72b96be6c')
model=WhisperModel(str(model_path),device='cpu',compute_type='int8',cpu_threads=6,local_files_only=True)
source=sys.argv[1] if len(sys.argv)>1 else str(HERE/'founder-source.wav')
name=sys.argv[2] if len(sys.argv)>2 else 'founder-source'
with wave.open(source,'rb') as wav:
    assert wav.getnchannels()==1 and wav.getframerate()==16000 and wav.getsampwidth()==2
    samples=np.frombuffer(wav.readframes(wav.getnframes()),dtype=np.int16).astype(np.float32)/32768.0
segments,info=model.transcribe(samples,language='en',beam_size=5,word_timestamps=True,
    initial_prompt='Viren Chauhan. Screenmate. AI Tinkerers. Agents Everywhere Hackathon. OpenAI. Atlanta.',
    condition_on_previous_text=False,vad_filter=False)
data=[]
for seg in segments:
    item={'start':seg.start,'end':seg.end,'text':seg.text,'words':[{'start':w.start,'end':w.end,'word':w.word,'probability':w.probability} for w in seg.words]}
    data.append(item)
    print(f'{seg.start:.2f} - {seg.end:.2f}: {seg.text}',flush=True)
(HERE/f'{name}-transcript.json').write_text(json.dumps(data,indent=2),encoding='utf-8')
print('Finished',name,flush=True)
