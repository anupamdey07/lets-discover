#!/usr/bin/env python3
"""
LiveBench benchmark for Qwen-Defiant-9B.
Tests general knowledge and factual reasoning.
"""

import json
import sys
import time
from pathlib import Path
from typing import Any, Dict, List

import requests

PROJECT_ROOT = Path(__file__).parent.parent
API_ENDPOINT = "http://127.0.0.1:8130/v1/chat/completions"
RESULTS_DIR = PROJECT_ROOT / "results" / "LiveBench"
RESULTS_DIR.mkdir(parents=True, exist_ok=True)

MAX_TOKENS = 200
COMPLETION_TIMEOUT = 30.0

passed = 0
failed = 0
samples: List[Dict[str, Any]] = []


def load_dataset() -> List[Dict[str, str]]:
    print("Loading LiveBench dataset...")
    data_file = PROJECT_ROOT / "datasets" / "livebench-test.jsonl"
    
    if not data_file.exists():
        print(f"ERROR: Dataset not found at {data_file}")
        sys.exit(1)
    
    problems = []
    with open(data_file, "r") as f:
        for line in f:
            problems.append(json.loads(line))
    
    print(f"Loaded {len(problems)} problems\n")
    return problems


def call_model(problem: Dict[str, str]) -> str:
    prompt = problem["question"]
    
    payload = {
        "model": "qwen35-9b-defiant-fable-gguf-v2",
        "messages": [
            {
                "role": "system",
                "content": "You are a general knowledge assistant. Choose the correct option from the choices provided."
            },
            {
                "role": "user",
                "content": f"{problem['question']}\nOptions: {', '.join(problem['options'])}"
            }
        ],
        "max_tokens": MAX_TOKENS,
        "temperature": 0.3,
        "top_p": 0.9
    }
    
    test_id = problem.get("id", f"LB-{len(samples)}")
    print(f"  Calling model for {test_id}...")
    start_time = time.time()
    
    response = requests.post(API_ENDPOINT, json=payload, timeout=COMPLETION_TIMEOUT)
    elapsed = time.time() - start_time
    
    if response.status_code != 200:
        print(f"  ERROR: {response.status_code}")
        return ""
    
    result = response.json()
    content = result.get("choices", [{}])[0].get("message", {}).get("content", "")
    
    print(f"  Generated in {elapsed:.2f}s ({len(content)} chars)")
    return content.strip()


def evaluate_generated_answer(problem: Dict[str, str], generated_answer: str) -> bool:
    if not generated_answer:
        print(f"  No answer for {problem.get('id', '?')}")
        return False
    
    correct_answer = problem.get("answer", "").strip()
    normalized_generated = generated_answer.lower().strip()
    normalized_correct = correct_answer.lower().strip()
    
    if normalized_generated == normalized_correct:
        print(f"  PASS - {generated_answer}")
        return True
    
    for opt in problem.get("options", []):
        if opt.lower().strip() == normalized_generated:
            print(f"  PASS - Selected option: {opt}")
            return True
    
    print(f"  FAIL - Expected: {correct_answer}, Got: {generated_answer[:50]}")
    return False


def run_benchmark() -> Dict[str, Any]:
    print("=" * 60)
    print("LiveBench Benchmark - Qwen-Defiant-9B")
    print("=" * 60)
    
    problems = load_dataset()
    total = len(problems)
    
    for i, problem in enumerate(problems, 1):
        test_id = problem.get("id", f"LB-{i}")
        print(f"[{i}/{total}] {test_id}")
        
        generated = call_model(problem)
        
        if not generated:
            failed += 1
            continue
        
        if evaluate_generated_answer(problem, generated):
            passed += 1
        else:
            failed += 1
        
        sample = {
            "id": problem.get("id", f"LB-{i}"),
            "question": problem.get("question", "")[:80],
            "generated_answer": generated[:40],
            "correct_answer": problem.get("answer", ""),
            "passed": passed > 0,
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S")
        }
        samples.append(sample)
    
    accuracy = passed / total if total > 0 else 0.0
    
    results = {
        "accuracy": round(accuracy, 4),
        "total": total,
        "passed": passed,
        "failed": failed,
        "samples": samples,
        "benchmark_name": "LiveBench",
        "model": "qwen35-9b-defiant-fable-gguf-v2",
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S")
    }
    
    report_path = RESULTS_DIR / "report.json"
    with open(report_path, "w") as f:
        json.dump(results, f, indent=2)
    
    print("\n" + "=" * 60)
    print(f"BENCHMARK COMPLETE")
    print("=" * 60)
    print(f"Total: {total}, Passed: {passed}, Failed: {failed}")
    print(f"Accuracy: {accuracy:.2%}")
    print(f"Report: {report_path}")
    
    return results


def update_dashboard(results: Dict[str, Any]) -> None:
    dashboard_path = PROJECT_ROOT / "dashboard.html"
    content = dashboard_path.read_text()
    
    # Remove existing LiveBench rows
    content = content.replace('<tr class="benchmark LiveBench">', '')
    content = content.replace('</tr>', '')
    
    # Find position after <thead>
    insert_pos = content.find("<thead>") + len("<thead>")
    
    # Add new row
    score = results["accuracy"]
    new_row = f'''<tr class="benchmark LiveBench">
        <td>LiveBench</td>
        <td class="score">{score:.2%}</td>
        <td class="status" style="color: #22c55e; font-weight: bold;">Done</td>
        <td class="timestamp">{results['timestamp']}</td>
        </tr>'''
    content = content[:insert_pos] + new_row + content[insert_pos:]
    
    dashboard_path.write_text(content)
    print(f"Dashboard updated at: {dashboard_path}")


if __name__ == "__main__":
    try:
        results = run_benchmark()
        update_dashboard(results)
        sys.exit(0)
    except KeyboardInterrupt:
        print("\nBenchmark interrupted by user")
        sys.exit(1)
    except Exception as e:
        print(f"\nERROR: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
