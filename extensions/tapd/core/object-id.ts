/** Convert a TAPD short object ID to the cloud API's full object ID. */
export function longTapdObjectId(
	workspaceId: string,
	objectId: string,
): string {
	if (!/^\d{1,9}$/.test(objectId)) return objectId;
	return `11${workspaceId}${objectId.padStart(9, "0")}`;
}
