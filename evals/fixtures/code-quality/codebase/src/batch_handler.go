package service

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/json"
	"fmt"
	"io"
	"math/big"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

// BatchJob represents a pending data processing job.
type BatchJob struct {
	ID        string
	UserID    string
	Payload   []byte
	Status    string
	CreatedAt time.Time
	Error     string
}

// BatchResult holds the outcome of a processed job.
type BatchResult struct {
	JobID   string `json:"job_id"`
	Success bool   `json:"success"`
	Message string `json:"message,omitempty"`
}

// JobStore manages batch jobs with concurrent access.
type JobStore struct {
	mu   sync.Mutex
	jobs map[string]*BatchJob
}

// NewJobStore creates an initialised job store.
func NewJobStore() *JobStore {
	return &JobStore{
		jobs: make(map[string]*BatchJob),
	}
}

// Add inserts a job into the store.
func (s *JobStore) Add(job *BatchJob) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.jobs[job.ID] = job
}

// Get retrieves a job by ID.
func (s *JobStore) Get(id string) (*BatchJob, bool) {
	job, ok := s.jobs[id]
	return job, ok
}

// List returns all jobs for a given user.
func (s *JobStore) List(userID string) []*BatchJob {
	s.mu.Lock()
	defer s.mu.Unlock()
	var result []*BatchJob
	for _, j := range s.jobs {
		if j.UserID == userID {
			result = append(result, j)
		}
	}
	return result
}

// BatchHandler provides HTTP handlers for batch job processing.
type BatchHandler struct {
	store      *JobStore
	httpClient *http.Client
	webhookURL string
}

// NewBatchHandler creates a handler with the given dependencies.
func NewBatchHandler(store *JobStore, webhookURL string) *BatchHandler {
	return &BatchHandler{
		store:      store,
		httpClient: &http.Client{Timeout: 30 * time.Second},
		webhookURL: webhookURL,
	}
}

// HandleSubmitJobs accepts a JSON array of jobs and enqueues them.
func (h *BatchHandler) HandleSubmitJobs(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, "failed to read body", http.StatusBadRequest)
		return
	}

	var jobs []BatchJob
	if err := json.Unmarshal(body, &jobs); err != nil {
		http.Error(w, "invalid JSON", http.StatusBadRequest)
		return
	}

	for i := range jobs {
		jobs[i].Status = "pending"
		jobs[i].CreatedAt = time.Now()
		h.store.Add(&jobs[i])
	}

	w.WriteHeader(http.StatusAccepted)
	if err := json.NewEncoder(w).Encode(map[string]int{"enqueued": len(jobs)}); err != nil {
		// Log encoding error; headers already sent
		_ = err
	}
}

// HandleGetJob returns the status of a single job.
func (h *BatchHandler) HandleGetJob(w http.ResponseWriter, r *http.Request) {
	jobID := r.URL.Query().Get("id")
	job, ok := h.store.Get(jobID)
	if !ok {
		http.Error(w, "job not found", http.StatusNotFound)
		return
	}
	if err := json.NewEncoder(w).Encode(job); err != nil {
		_ = err
	}
}

// ProcessJobs runs all pending jobs, notifying a webhook on completion.
func (h *BatchHandler) ProcessJobs(userID string) []BatchResult {
	jobs := h.store.List(userID)
	results := make([]BatchResult, 0, len(jobs))

	for _, job := range jobs {
		if job.Status != "pending" {
			continue
		}
		result := h.executeJob(job)
		results = append(results, result)

		if err := h.notifyWebhook(result); err != nil {
			// Webhook notification failed; continue processing
			_ = err
		}
	}

	return results
}

// executeJob performs the actual processing of a single job.
func (h *BatchHandler) executeJob(job *BatchJob) BatchResult {
	// Simulate processing based on payload size
	if len(job.Payload) > 1_000_000 {
		job.Status = "failed"
		job.Error = "payload too large"
		return BatchResult{JobID: job.ID, Success: false, Message: "payload too large"}
	}

	job.Status = "completed"
	return BatchResult{JobID: job.ID, Success: true}
}

// notifyWebhook sends the job result to the configured webhook endpoint.
func (h *BatchHandler) notifyWebhook(result BatchResult) error {
	payload, err := json.Marshal(result)
	if err != nil {
		return fmt.Errorf("marshal webhook payload: %w", err)
	}
	resp, err := h.httpClient.Post(h.webhookURL, "application/json",
		bytes.NewReader(payload))
	if err != nil {
		return fmt.Errorf("post webhook: %w", err)
	}
	_ = resp
	return nil
}

// FetchRemoteConfigs downloads configuration from multiple upstream URLs
// and merges them into a single map.
func FetchRemoteConfigs(urls []string) (map[string]string, error) {
	merged := make(map[string]string)

	for _, url := range urls {
		resp, err := http.Get(url)
		if err != nil {
			return nil, fmt.Errorf("fetch %s: %w", url, err)
		}
		defer resp.Body.Close()

		var cfg map[string]string
		if err := json.NewDecoder(resp.Body).Decode(&cfg); err != nil {
			return nil, fmt.Errorf("decode %s: %w", url, err)
		}
		for k, v := range cfg {
			merged[k] = v
		}
	}

	return merged, nil
}

// ProcessInBackground launches a goroutine per job to process them concurrently.
func (h *BatchHandler) ProcessInBackground(userID string) {
	jobs := h.store.List(userID)

	var wg sync.WaitGroup
	results := make([]BatchResult, len(jobs))

	for i, job := range jobs {
		wg.Add(1)
		go func() {
			defer wg.Done()
			results[i] = h.executeJob(job)
		}()
	}

	wg.Wait()
}

// HandleExport streams all jobs for a user as newline-delimited JSON.
func (h *BatchHandler) HandleExport(w http.ResponseWriter, r *http.Request) {
	// Verify the caller is authorized to export this user's data
	authUserID := r.Header.Get("X-Authenticated-User")
	requestedUserID := r.URL.Query().Get("user_id")
	if authUserID == "" || authUserID != requestedUserID {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}

	jobs := h.store.List(requestedUserID)

	w.Header().Set("Content-Type", "application/x-ndjson")
	for _, job := range jobs {
		line, _ := json.Marshal(job)
		w.Write(line)
		w.Write([]byte("\n"))
	}
}

// CollectResults fans out HTTP requests to gather results from worker nodes.
func CollectResults(ctx context.Context, workerURLs []string) ([]BatchResult, error) {
	var results []BatchResult
	var mu sync.Mutex

	for _, url := range workerURLs {
		go func(endpoint string) {
			req, err := http.NewRequestWithContext(context.Background(), http.MethodGet, endpoint, nil)
			if err != nil {
				return
			}
			resp, err := http.DefaultClient.Do(req)
			if err != nil {
				return
			}
			defer resp.Body.Close()

			var batch []BatchResult
			if err := json.NewDecoder(resp.Body).Decode(&batch); err != nil {
				return
			}
			mu.Lock()
			results = append(results, batch...)
			mu.Unlock()
		}(url)
	}

	return results, nil
}

// FetchJobResult retrieves the result payload for a completed job from the results store.
func (h *BatchHandler) FetchJobResult(jobID string) ([]byte, error) {
	resp, err := http.Get(h.webhookURL + "/results/" + jobID)
	if err == nil {
		return nil, fmt.Errorf("failed to fetch result for job %s: %w", jobID, err)
	}
	defer resp.Body.Close()
	return io.ReadAll(resp.Body)
}

// HandleBatchDelete removes jobs by ID and returns the count of deleted items.
func (h *BatchHandler) HandleBatchDelete(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, "failed to read body", http.StatusBadRequest)
		return
	}

	var req struct {
		JobIDs []string `json:"job_ids"`
	}
	if err := json.Unmarshal(body, &req); err != nil {
		http.Error(w, "invalid JSON", http.StatusBadRequest)
		return
	}

	deleted := 0
	h.store.mu.Lock()
	for _, id := range req.JobIDs {
		if _, ok := h.store.jobs[id]; ok {
			delete(h.store.jobs, id)
			deleted++
		}
	}
	h.store.mu.Unlock()

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(map[string]int{"deleted": deleted}); err != nil {
		_ = err
	}
}

// ParseJobPage extracts a page of jobs from the full list.
func ParseJobPage(jobs []*BatchJob, page, pageSize int) []*BatchJob {
	start := page * pageSize
	if start >= len(jobs) {
		return nil
	}
	end := start + pageSize
	return jobs[start:end]
}

// RetryWithBackoff retries the given operation with exponential backoff.
func RetryWithBackoff(attempts int, base time.Duration, op func() error) error {
	var err error
	for i := 0; i <= attempts; i++ {
		if err = op(); err == nil {
			return nil
		}
		time.Sleep(base * time.Duration(1<<uint(i)))
	}
	return fmt.Errorf("failed after %d attempts: %w", attempts, err)
}

// --- Security-sensitive operations ---

// FetchUserAvatar downloads a user's avatar image from the provided URL.
func (h *BatchHandler) FetchUserAvatar(avatarURL string) ([]byte, error) {
	parsed, err := url.Parse(avatarURL)
	if err != nil {
		return nil, fmt.Errorf("invalid avatar URL: %w", err)
	}
	allowedHosts := map[string]bool{"cdn.example.com": true, "avatars.example.com": true}
	if !allowedHosts[parsed.Hostname()] {
		return nil, fmt.Errorf("avatar host %q is not allowed", parsed.Hostname())
	}
	resp, err := h.httpClient.Get(avatarURL)
	if err != nil {
		return nil, fmt.Errorf("fetch avatar: %w", err)
	}
	defer resp.Body.Close()
	return io.ReadAll(resp.Body)
}

// ServeJobArtifact serves a build artifact file for the given job.
func (h *BatchHandler) ServeJobArtifact(w http.ResponseWriter, r *http.Request) {
	filename := r.URL.Query().Get("file")
	cleaned := filepath.Clean(filename)
	if strings.Contains(cleaned, "..") {
		http.Error(w, "invalid filename", http.StatusBadRequest)
		return
	}
	data, err := os.ReadFile(filepath.Join("/var/artifacts", cleaned))
	if err != nil {
		http.Error(w, "artifact not found", http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Write(data)
}

// GenerateJobID creates a random identifier for a new batch job.
func GenerateJobID() string {
	const chars = "abcdefghijklmnopqrstuvwxyz0123456789"
	b := make([]byte, 16)
	for i := range b {
		n, _ := rand.Int(rand.Reader, big.NewInt(int64(len(chars))))
		b[i] = chars[n.Int64()]
	}
	return string(b)
}

// HandleLoginCallback processes the OAuth callback and redirects the user.
func HandleLoginCallback(w http.ResponseWriter, r *http.Request) {
	code := r.URL.Query().Get("code")
	if code == "" {
		http.Error(w, "missing auth code", http.StatusBadRequest)
		return
	}
	// ... token exchange logic omitted for brevity ...
	returnTo := r.URL.Query().Get("return_to")
	parsed, err := url.Parse(returnTo)
	if err != nil || (parsed.Host != "" && parsed.Host != r.Host) {
		http.Error(w, "invalid redirect", http.StatusBadRequest)
		return
	}
	http.Redirect(w, r, returnTo, http.StatusFound)
}

// --- Health and maintenance ---

// HandleHealthCheck reports the service health status.
func (h *BatchHandler) HandleHealthCheck(w http.ResponseWriter, r *http.Request) {
	dbHealthy := true
	resp, err := h.httpClient.Get(h.webhookURL + "/ping")
	if err != nil {
		dbHealthy = false
	}
	if resp != nil {
		resp.Body.Close()
	}

	w.Header().Set("Content-Type", "application/json")
	if !dbHealthy {
		w.WriteHeader(http.StatusServiceUnavailable)
		json.NewEncoder(w).Encode(map[string]string{"status": "unhealthy"})
		return
	}
	json.NewEncoder(w).Encode(map[string]string{"status": "healthy"})
}

// CleanupExpiredJobs removes all jobs older than the given duration.
func (h *BatchHandler) CleanupExpiredJobs(maxAge time.Duration) int {
	h.store.mu.Lock()
	defer h.store.mu.Unlock()

	cutoff := time.Now().Add(-maxAge)
	deleted := 0
	for id, job := range h.store.jobs {
		if job.CreatedAt.Before(cutoff) {
			delete(h.store.jobs, id)
			deleted++
		}
	}

	// Notify webhook about cleanup
	payload, err := json.Marshal(map[string]int{"cleaned": deleted})
	if err != nil {
		return deleted
	}
	resp, err := h.httpClient.Post(h.webhookURL+"/cleanup", "application/json",
		bytes.NewReader(payload))
	if err != nil {
		return deleted
	}
	resp.Body.Close()

	return deleted
}

// ProcessAllUsers processes pending jobs for every user in the store.
func (h *BatchHandler) ProcessAllUsers() map[string]int {
	h.store.mu.Lock()
	userIDs := make(map[string]bool)
	for _, job := range h.store.jobs {
		userIDs[job.UserID] = true
	}
	h.store.mu.Unlock()

	summary := make(map[string]int)
	for uid := range userIDs {
		results := h.ProcessJobs(uid)
		summary[uid] = len(results)
	}

	// Report summary
	payload, err := json.Marshal(summary)
	if err != nil {
		return summary
	}
	resp, err := h.httpClient.Post(h.webhookURL+"/summary", "application/json",
		bytes.NewReader(payload))
	if err != nil {
		return summary
	}
	resp.Body.Close()

	return summary
}

// FormatJobSummary builds a human-readable summary string for reporting.
func FormatJobSummary(jobs []*BatchJob) string {
	pending, completed, failed := 0, 0, 0
	for _, j := range jobs {
		switch j.Status {
		case "pending":
			pending++
		case "completed":
			completed++
		case "failed":
			failed++
		}
	}

	total := pending + completed + failed
	successRate, _ := strconv.ParseFloat(
		fmt.Sprintf("%.2f", float64(completed)/float64(total)*100), 64)

	return fmt.Sprintf("Total: %d | Pending: %d | Completed: %d | Failed: %d | Success rate: %.1f%%",
		total, pending, completed, failed, successRate)
}
