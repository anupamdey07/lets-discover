#!/usr/bin/env python3
"""
ARC-like reasoning benchmark for Qwen-Defiant-9B.
- Loads synthetic reasoning problems
- Sends prompts via llama-server
- Evaluates answers against correct choices
- Writes results to results/ARC_AGI/report.json
"""

import json
import sys
import time
from pathlib import Path
from typing import Any, Dict, List

import requests

# Project root
PROJECT_ROOT = Path(__file__).parent.parent

# API endpoint
API_ENDPOINT = "http://127.0.0.1:8130/v1/chat/completions"

# Results directory
RESULTS_DIR = PROJECT_ROOT / "results" / "ARC_AGI"
RESULTS_DIR.mkdir(parents=True, exist_ok=True)

# Configuration
MAX_TOKENS = 400
COMPLETION_TIMEOUT = 30.0

# Results tracking
passed = 0
failed = 0
samples: List[Dict[str, Any]] = []


def load_dataset() -> List[Dict[str, str]]:
    """Load ARC-like dataset."""
    print("Loading ARC-like dataset...")
    data_file = PROJECT_ROOT / "datasets" / "arc-like-test.jsonl"
    
    if not data_file.exists():
        print(f"ERROR: Dataset not found at {data_file}")
        print(f"Available files: {list(PROJECT_ROOT.rglob('*.jsonl'))}")
        sys.exit(1)
    
    problems = []
    with open(data_file, "r") as f:
        for line in f:
            problems.append(json.loads(line))
    
    print(f"Loaded {len(problems)} problems\n")
    return problems


def call_model(problem: Dict[str, str]) -> str:
    """
    Call the local llama-server via chat completions API.
    """
    prompt = problem["question"]
    
    payload = {
        "model": "qwen35-9b-defiant-fable-gguf-v2",
        "messages": [
            {
                "role": "system",
                "content": "You are a reasoning assistant. Solve the pattern recognition problem and return ONLY the answer choice (e.g., 'A', 'B', 'C', or the number)."
            },
            {
                "role": "user",
                "content": prompt
            }
        ],
        "max_tokens": MAX_TOKENS,
        "temperature": 0.5,
        "top_p": 0.9
    }
    
    test_id = problem.get("id", f"ARC-{len(samples)}")
    print(f"  Calling model for {test_id}...")
    start_time = time.time()
    
    response = requests.post(API_ENDPOINT, json=payload, timeout=COMPLETION_TIMEOUT)
    elapsed = time.time() - start_time
    
    if response.status_code != 200:
        print(f"  ERROR: Request failed with status {response.status_code}")
        print(f"  Response body: {response.text[:200]}")
        return ""
    
    result = response.json()
    content = result.get("choices", [{}])[0].get("message", {}).get("content", "")
    
    print(f"  Generated in {elapsed:.2f}s ({len(content)} chars)")
    return content.strip()


def evaluate_generated_answer(problem: Dict[str, str], generated_answer: str) -> bool:
    """
    Evaluate if the generated answer matches the correct choice.
    """
    if not generated_answer:
        print(f"  No answer generated for {problem.get('id', '?')}")
        return False
    
    correct_answer = problem.get("answer", "").strip()
    
    # Check if generated answer contains or equals the correct answer
    normalized_generated = generated_answer.lower().strip()
    normalized_correct = correct_answer.lower().strip()
    
    # Direct match
    if normalized_generated == normalized_correct:
        print(f"  PASS - Generated: {generated_answer[:50]}")
        return True
    
    # Check if correct answer is in options and generated matches one
    options = problem.get("options", [])
    if options:
        # Find which option the model selected (if any)
        for opt in options:
            if opt.lower().strip() == normalized_generated:
                print(f"  PASS - Selected option: {opt}")
                return True
    
    print(f"  FAIL - Expected: {correct_answer}, Got: {generated_answer[:50]}")
    return False


def run_benchmark() -> Dict[str, Any]:
    """
    Run the full ARC-like benchmark.
    """
    print("=" * 60)
    print("ARC-like Reasoning Benchmark - Qwen-Defiant-9B")
    print("=" * 60)
    
    # Load dataset
    problems = load_dataset()
    total = len(problems)
    print(f"Loaded {total} problems\n")
    
    # Run each problem
    for i, problem in enumerate(problems, 1):
        test_id = problem.get("id", f"ARC-{i}")
        print(f"[{i}/{total}] {test_id}")
        
        # Generate answer
        generated = call_model(problem)
        
        if not generated:
            failed += 1
            continue
        
        # Evaluate
        if evaluate_generated_answer(problem, generated):
            passed += 1
        else:
            failed += 1
        
        # Record sample
        sample = {
            "id": problem.get("id", f"ARC-{i}"),
            "question": problem.get("question", "")[:200],
            "generated_answer": generated[:100],
            "correct_answer": problem.get("answer", ""),
            "passed": passed > 0,
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S")
        }
        samples.append(sample)
    
    # Calculate accuracy
    accuracy = passed / total if total > 0 else 0.0
    
    # Compile results
    results = {
        "accuracy": round(accuracy, 4),
        "total": total,
        "passed": passed,
        "failed": failed,
        "samples": samples,
        "benchmark_name": "ARC_AGI",
        "model": "qwen35-9b-defiant-fable-gguf-v2",
        "api_endpoint": API_ENDPOINT,
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S")
    }
    
    # Write report
    report_path = RESULTS_DIR / "report.json"
    with open(report_path, "w") as f:
        json.dump(results, f, indent=2)
    
    print("\n" + "=" * 60)
    print(f"BENCHMARK COMPLETE")
    print("=" * 60)
    print(f"Total problems: {total}")
    print(f"Passed: {passed}")
    print(f"Failed: {failed}")
    print(f"Accuracy: {accuracy:.2%}")
    print(f"Report saved to: {report_path}")
    
    return results


def update_dashboard(results: Dict[str, Any]) -> None:
    """
    Update the dashboard HTML with the new benchmark result.
    """
    dashboard_path = PROJECT_ROOT / "dashboard.html"
    content = dashboard_path.read_text()
    
    # Remove existing ARC_AGI rows
    content = content.replace('<tr class="benchmark ARC_AGI">', '')
    content = content.replace('</tr>', '')
    
    # Find position after <thead>
    insert_pos = content.find("<thead>") + len("<thead>")
    
    # Add new row
    score = results["accuracy"]
    new_row = f'''<tr class="benchmark ARC_AGI">
        <td>ARC-AGI</td>
        <td class="score">{score:.2%}</td>
        <td class="status" style="color: #22c55e; font-weight: bold;">Done</td>
        <td class="timestamp">{results['timestamp']}</td>
        </tr>'''
    content = content[:insert_pos] + new_row + content[insert_pos:]
    
    # Write updated dashboard
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
