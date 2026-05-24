# ttasks TypeScript port test TODO

Track the port of the Python `ttasks` test suite into Chamber's isolated TypeScript module at:

```text
packages/services/src/tasks/
```

Reference source repo/tests:

```text
/home/cip/src/ttasks/tests/
```

Target test style: Vitest.

Legend:

- [x] not ported
- [~] ported but failing / needs implementation adjustment
- [x] ported and passing
- [n/a] intentionally not ported, with reason

## Target files

- [x] `packages/services/src/tasks/events.test.ts`
- [x] `packages/services/src/tasks/executor.test.ts`
- [x] `packages/services/src/tasks/graph-ledger.test.ts`
- [x] `packages/services/src/tasks/ledger-deletion.test.ts`
- [x] `packages/services/src/tasks/ledger.test.ts`
- [x] `packages/services/src/tasks/public-api.test.ts`
- [x] `packages/services/src/tasks/task.test.ts`
- [x] `packages/services/src/tasks/workflow.test.ts`

## `tests/test_events.py` -> `events.test.ts`

- [x] `test_event_bus_subscribe_receives_emitted_event`
- [x] `test_event_bus_unsubscribe_stops_future_events`
- [x] `test_event_bus_rejects_non_callable_subscribers`
- [x] `test_event_bus_records_subscriber_errors_without_stopping_emit`

## `tests/test_executor.py` -> `executor.test.ts`

- [x] `test_task_context_exposes_read_only_task_view`
- [x] `test_task_context_exposes_read_only_upstream_task_refs`
- [x] `test_register_rejects_non_task_type`
- [x] `test_register_rejects_non_callable_handler`
- [x] `test_execute_success_emits_started_and_succeeded_events`
- [x] `test_execute_failure_emits_started_and_failed_events`
- [x] `test_execute_cancellation_emits_started_and_cancelled_events`
- [x] `test_retry_after_failure_emits_started_event_from_failed_status`
- [x] `test_execute_passes_upstream_task_refs_to_handler`
- [x] `test_execute_moves_task_through_running_to_done`
- [x] `test_task_result_wraps_non_string_raw_values`
- [x] `test_execute_rejects_task_without_registered_handler`
- [x] `test_handler_failure_marks_task_failed_and_stores_error`
- [x] `test_execute_rejects_cancelled_task_without_calling_handler`
- [x] `test_executor_clears_previous_error_on_successful_retry`
- [x] `test_successful_execute_sets_task_result_timing`
- [x] `test_default_executor_can_execute_bash`
- [x] `test_bash_task_supports_shell_syntax`
- [x] `test_bash_nonzero_exit_marks_task_failed`
- [x] `test_bash_failure_uses_stderr_as_error`
- [x] `test_failed_subprocess_result_preserves_output_error_and_returncode`
- [x] `test_running_process_registry_is_cleaned_after_failure`
- [x] `test_powershell_task_executes`
- [x] `test_bash_task_without_timeout_waits_for_completion`
- [x] `test_bash_task_times_out`
- [x] `test_timed_out_subprocess_result_preserves_partial_output`
- [x] `test_handler_cancellation_after_return_raises_task_cancelled`
- [x] `test_handler_task_cancelled_exception_marks_task_cancelled`
- [x] `test_handler_error_after_cancellation_raises_task_cancelled`
- [x] `test_cancel_without_running_process_only_cancels_task`
- [x] `test_run_command_terminates_if_task_cancelled_during_process_start`
- [x] `test_run_command_reports_cancelled_nonzero_process_as_task_cancelled`
- [x] `test_terminate_process_ignores_already_exited_process`
- [x] `test_terminate_process_escalates_to_sigkill`
- [x] `test_terminate_process_ignores_missing_group_during_sigkill`
- [x] `test_make_copilot_prompt_handler_rejects_empty_model`
- [x] `test_make_copilot_prompt_handler_rejects_non_positive_timeout`
- [x] `test_default_prompt_handler_uses_copilot_sdk`
- [x] `test_copilot_prompt_handler_uses_task_timeout`
- [x] `test_copilot_prompt_handler_allows_model_override`
- [x] `test_copilot_prompt_handler_none_response_returns_empty_string`
- [x] `test_copilot_prompt_handler_unknown_response_data_returns_empty_string`
- [x] `test_copilot_prompt_handler_sdk_error_marks_task_failed`
- [x] `test_make_copilot_agent_handler_rejects_empty_model`
- [x] `test_default_agent_handler_uses_copilot_sdk_with_tools_enabled`
- [x] `test_copilot_agent_handler_uses_task_timeout`
- [x] `test_copilot_agent_handler_allows_model_override`
- [x] `test_copilot_agent_handler_sdk_error_marks_task_failed`
- [x] `test_cancel_stops_in_flight_bash_task`
- [x] `test_task_result_is_none_before_execution`
- [x] `test_successful_execute_sets_task_result`
- [x] `test_failed_execute_sets_task_result_with_failed_status`
- [x] `test_cancelled_execute_sets_task_result_with_cancelled_status`
- [x] `test_retry_after_failure_replaces_task_result`

## `tests/test_graph_ledger.py` -> `graph-ledger.test.ts`

- [x] `test_graph_ledger_rejects_non_graph_values`
- [x] `test_graph_ledger_rejects_graph_id_mismatch`
- [x] `test_graph_ledger_accepts_graph_under_its_own_id`
- [x] `test_graph_ledger_iterates_in_insertion_order`
- [x] `test_graph_ledger_repr_includes_graph_count`
- [x] `test_graph_ledger_get_missing_graph_raises_key_error`
- [x] `test_graph_ledger_del_removes_graph`
- [x] `test_graph_ledger_delete_missing_graph_raises_key_error`
- [x] `test_graph_id_cannot_change_after_storing_in_graph_ledger`

## `tests/test_ledger_deletion.py` -> `ledger-deletion.test.ts`

- [x] `test_del_removes_task_from_ledger`
- [x] `test_delete_missing_task_raises_key_error`
- [x] `test_cancel_missing_task_raises_key_error`
- [x] `test_cancel_marks_task_cancelled_and_keeps_it_in_ledger`

## `tests/test_ledger.py` -> `ledger.test.ts`

- [x] `test_ledger_rejects_non_task_values`
- [x] `test_ledger_rejects_task_id_mismatch`
- [x] `test_iterates_over_tasks_in_insertion_order`
- [x] `test_repr_includes_task_count`
- [x] `test_get_missing_task_raises_key_error`
- [x] `test_task_id_cannot_change_after_storing_in_ledger`
- [x] `test_ledger_accepts_task_under_its_own_id`

## `tests/test_public_api.py` -> `public-api.test.ts`

- [x] `test_all_lists_every_public_name`
- [x] `test_every_public_name_is_importable_from_top_level`
- [x] `test_top_level_names_are_the_same_objects_as_submodule_names`

## `tests/test_task.py` -> `task.test.ts`

- [x] `test_type_must_be_task_type`
- [x] `test_timeout_must_be_positive`
- [x] `test_repr_includes_identity_title_and_status`
- [x] `test_timeout_defaults_to_no_automatic_timeout`
- [x] `test_timeout_accepts_positive_values`
- [x] `test_id_is_read_only`
- [x] `test_status_is_read_only`
- [x] `test_can_transition_to_rejects_non_task_status`
- [x] `test_transition_to_rejects_non_task_status`
- [x] `test_status_changes_through_transition_to`
- [x] `test_cancel_changes_status_through_state_machine`
- [x] `test_cancel_is_idempotent`
- [x] `test_cancel_preserves_previous_error`
- [x] `test_done_tasks_reject_public_field_mutation`
- [x] `test_invalid_transition_preserves_error`
- [x] `test_failed_tasks_remain_mutable_for_retry`
- [x] `test_allowed_transitions`
- [x] `test_disallowed_transitions_are_rejected`

## `tests/test_workflow.py` -> `workflow.test.ts`

- [x] `test_graph_has_read_only_id`
- [x] `test_graph_accepts_title`
- [x] `test_graph_rejects_non_string_title`
- [x] `test_graph_created_at_defaults_to_now`
- [x] `test_setitem_registers_task_in_ledger`
- [x] `test_getitem_returns_dep_tasks`
- [x] `test_contains_accepts_task_only`
- [x] `test_iter_yields_all_tasks`
- [x] `test_len_counts_tasks`
- [x] `test_repr_includes_edges`
- [x] `test_default_constructor_creates_own_ledger`
- [x] `test_constructor_uses_provided_ledger`
- [x] `test_constructor_accepts_positional_ledger`
- [x] `test_ledger_can_be_pre_populated`
- [x] `test_run_rejects_non_positive_max_workers`
- [x] `test_run_raises_on_unregistered_dep`
- [x] `test_run_raises_on_self_loop`
- [x] `test_run_raises_on_two_node_cycle`
- [x] `test_run_raises_on_larger_cycle`
- [x] `test_graph_passes_direct_upstream_task_refs`
- [x] `test_graph_passes_only_direct_upstream_task_refs`
- [x] `test_empty_graph_runs_without_hanging`
- [x] `test_single_node_runs`
- [x] `test_linear_chain_runs_in_order`
- [x] `test_diamond_runs_with_parallelism`
- [x] `test_graph_records_executor_errors`
- [x] `test_executor_error_blocks_descendants`
- [x] `test_failure_blocks_descendants`
- [x] `test_failure_does_not_affect_independent_branch`
- [x] `test_failure_in_diamond_blocks_only_downstream`
- [x] `test_failure_terminates_run_without_hanging`
- [x] `test_add_finally_runs_after_failed_and_blocked_tasks`
- [x] `test_optional_finally_failure_does_not_make_graph_not_ok`
- [x] `test_required_finally_failure_makes_graph_not_ok`
- [x] `test_add_finally_rejects_non_bool_required`
- [x] `test_ledger_carries_results_after_run`
- [x] `test_blocked_task_has_no_result_after_run`
- [x] `test_run_returns_self`
- [x] `test_run_returns_self_for_empty_graph`
- [x] `test_succeeded_lists_done_tasks_in_graph`
- [x] `test_succeeded_empty_before_run`
- [x] `test_succeeded_only_lists_graph_tasks_not_whole_ledger`
- [x] `test_cancelled_lists_cancelled_tasks`
- [x] `test_failed_lists_failed_tasks`
- [x] `test_failed_empty_when_all_succeed`
- [x] `test_blocked_lists_skipped_descendants`
- [x] `test_blocked_empty_before_run`
- [x] `test_blocked_empty_when_no_failures`
- [x] `test_blocked_resets_at_start_of_run`
- [x] `test_clean_graph_can_be_run_again_without_blocking_done_dependencies`
- [x] `test_done_dependency_allows_pending_descendant_to_run`
- [x] `test_cancelled_root_is_blocked_instead_of_hanging`
- [x] `test_ok_true_after_clean_run`
- [x] `test_ok_false_after_failure`
- [x] `test_ok_false_when_tasks_blocked`
- [x] `test_ok_false_before_run`
- [x] `test_ok_true_for_empty_graph`
- [x] `test_roots_returns_tasks_with_no_deps`
- [x] `test_roots_empty_for_empty_graph`
- [x] `test_roots_all_when_no_edges`
- [x] `test_leaves_returns_tasks_with_no_dependents`
- [x] `test_leaves_empty_for_empty_graph`
- [x] `test_diamond_roots_and_leaves`

## Porting notes / known adaptation points

- Python `datetime` values should become JavaScript `Date` instances.
- Python `subprocess.CompletedProcess` should become a small Node process result shape.
- Python `TaskStatus.PENDING` style should likely become TypeScript enums to keep tests close to the original.
- Python `pytest.raises` maps to Vitest `toThrow` / `rejects.toThrow`.
- Python `ThreadPoolExecutor` graph execution maps to async Promise scheduling with a concurrency limit.
- Copilot `PROMPT`/`AGENT` tests need TS equivalents using Chamber's installed SDK dependencies, but the module should remain isolated from existing Chamber services.
- PowerShell tests may need a platform guard if `pwsh` is unavailable in CI/dev environments.
